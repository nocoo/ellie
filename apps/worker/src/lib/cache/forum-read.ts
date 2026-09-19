// Hourly display snapshots and gates; mutations still invalidate by generation.
import {
	CACHE_TTL_SECONDS,
	type CacheDescriptor,
	canViewForumVisibility,
	type Forum,
	type ForumVisibility,
} from "@ellie/types";
import type { Env } from "../env";
import { ANONYMOUS_AUTHOR_NAME, parseModeratorIds, toForum } from "../mappers";
import { getUserProfiles } from "../user-cache";
import { getGen, UNAVAILABLE_CACHE_GENERATION } from "./epoch";
import {
	bucketToVisibilityContext,
	buildForumSummaryPayload,
	buildForumTreePayload,
	type ForumAggregateV2,
	type ForumSummaryPayloadV2,
	type ForumTreeNodeV2,
	type ForumTreePayloadV2,
	isForumSummaryPayload,
	isForumTreePayload,
} from "./forum";
import {
	forumSummaryGenKey,
	forumSummaryKey,
	forumTreeGenKey,
	forumTreeKey,
	type VisibilityBucket,
} from "./keys";
import { cacheGetOrSet } from "./wrap";

export const FORUM_TREE_TTL = CACHE_TTL_SECONDS.HOUR;
export const FORUM_SUMMARY_TTL = CACHE_TTL_SECONDS.HOUR;
export interface ForumSnapshotRow extends Forum {
	moderatorIds: string;
}
const STRUCTURE_COLUMNS = `id, parent_id, name, description, announcement, icon, display_order, type, status, visibility, moderators, moderator_ids, thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix`;
interface CurrentForum {
	id: number;
	parent_id: number;
	status: number;
	visibility: ForumVisibility;
	moderators: string;
	moderator_ids: string;
	thread_types_enabled: number;
	thread_types_required: number;
	thread_types_listable: number;
	thread_types_prefix: number;
}
interface GateSnapshot<T> {
	version: string;
	expiresAt: number;
	rows: Map<number, T>;
}
// ponytail: per-isolate hints avoid hot SQL without another KV payload family.
// Cold isolates reload; authoritative content/write authorization stays separate.
const forumGates = new WeakMap<KVNamespace, GateSnapshot<CurrentForum>>();
const latestGates = new WeakMap<KVNamespace, Map<string, GateSnapshot<Candidate>>>();

function canCacheGates(env: Env, version: string, family: string): boolean {
	return (
		version !== UNAVAILABLE_CACHE_GENERATION &&
		!(env.CACHE_DISABLED_FAMILIES ?? "").split(",").some((value) => value.trim() === family)
	);
}
function snapshot(row: Record<string, unknown>): ForumSnapshotRow {
	return {
		...toForum(row),
		moderatorIds: String(row.moderator_ids ?? ""),
		moderatorList: [],
		lastThreadSubject: "",
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastPostAt: 0,
	};
}
export async function loadForumStructure(env: Env): Promise<ForumSnapshotRow[]> {
	const result = await env.DB.prepare(
		`SELECT ${STRUCTURE_COLUMNS} FROM forums ORDER BY display_order, id`,
	).all<Record<string, unknown>>();
	if (!result.success) throw new Error("Forum structure could not be loaded");
	return result.results.map((row) => snapshot({ ...row, threads: 0, posts: 0, last_thread_id: 0 }));
}

/** One indexed newest-thread lookup per forum within a single SQL statement. */
const LAST_ID =
	"(SELECT t.id FROM threads t INDEXED BY idx_threads_forum_latest WHERE t.forum_id = f.id AND t.sticky >= 0 ORDER BY t.last_post_at DESC, t.id DESC LIMIT 1)";
const LAST_THREAD_COLUMNS = `t.id AS last_thread_id, t.subject AS last_thread_subject,
 t.last_post_at, t.last_poster, t.last_poster_id, t.anonymous_last_poster,
 u.username AS last_poster_name, u.avatar AS last_poster_avatar, u.avatar_path AS last_poster_avatar_path`;
const LAST_THREAD_JOINS = `LEFT JOIN threads t ON t.id = ${LAST_ID}
 LEFT JOIN users u ON u.id = t.last_poster_id`;

/** Display-only copies; current gates below still mask newly anonymous replies. */
function lastThreadFields(row: Record<string, unknown>) {
	const anonymous = row.anonymous_last_poster === 1;
	return {
		lastThreadId: Number(row.last_thread_id ?? 0),
		lastThreadSubject: String(row.last_thread_subject ?? ""),
		lastPostAt: Number(row.last_post_at ?? 0),
		lastPoster: anonymous
			? ANONYMOUS_AUTHOR_NAME
			: String(row.last_poster_name ?? row.last_poster ?? ""),
		lastPosterId: anonymous ? 0 : Number(row.last_poster_id ?? 0),
		lastPosterAvatar: anonymous ? "" : String(row.last_poster_avatar ?? ""),
		lastPosterAvatarPath: anonymous ? "" : String(row.last_poster_avatar_path ?? ""),
	};
}
export async function loadForumSnapshot(env: Env): Promise<ForumSnapshotRow[]> {
	const cutoff = Math.floor(Date.now() / 1000) - 86400;
	const [forums, counts] = await Promise.all([
		env.DB.prepare(
			`SELECT f.id, f.status, f.visibility, f.threads, f.posts, ${LAST_THREAD_COLUMNS} FROM forums f ${LAST_THREAD_JOINS}`,
		).all<Record<string, unknown>>(),
		env.DB.prepare(
			"SELECT forum_id, COUNT(*) AS cnt FROM threads INDEXED BY idx_threads_created WHERE created_at >= ? AND sticky >= 0 GROUP BY forum_id",
		)
			.bind(cutoff)
			.all<{ forum_id: number; cnt: number }>(),
	]);
	if (!forums.success || !counts.success) throw new Error("Forum summary could not be loaded");
	const today = new Map(counts.results.map((row) => [row.forum_id, row.cnt]));
	return forums.results.map((row) => ({
		...snapshot(row),
		...lastThreadFields(row),
		todayThreads: today.get(Number(row.id)) ?? 0,
	}));
}
export function lazyForumSnapshot(env: Env): () => Promise<ForumSnapshotRow[]> {
	let task: Promise<ForumSnapshotRow[]> | undefined;
	return () => (task ??= loadForumSnapshot(env));
}
export async function currentForums(
	env: Env,
	ancestorOf?: number,
): Promise<Map<number, CurrentForum>> {
	const version = ancestorOf === undefined ? await getGen(env, forumTreeGenKey()) : null;
	const cacheable = version !== null && canCacheGates(env, version, "forum:tree:v2");
	const cached = forumGates.get(env.KV);
	if (cacheable && cached?.version === version && cached.expiresAt > Date.now())
		return new Map(cached.rows);
	// UNION terminates malformed cycles. Single-forum context only checks its chain.
	const chain =
		ancestorOf === undefined
			? ""
			: `WITH RECURSIVE chain(id) AS (
		SELECT id FROM forums WHERE id = ?
		UNION SELECT f.parent_id FROM forums f JOIN chain c ON f.id = c.id WHERE f.parent_id > 0
	) `;
	const result = await env.DB.prepare(
		`${chain}SELECT id, parent_id, status, visibility, moderators, moderator_ids, thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix FROM forums${ancestorOf === undefined ? "" : " WHERE id IN (SELECT id FROM chain)"}`,
	)
		.bind(...(ancestorOf === undefined ? [] : [ancestorOf]))
		.all<CurrentForum>();
	if (!result.success) throw new Error("Current forum permissions could not be loaded");
	const rows = new Map(result.results.map((row) => [row.id, row]));
	if (cacheable)
		forumGates.set(env.KV, { version, expiresAt: Date.now() + FORUM_TREE_TTL * 1000, rows });
	return new Map(rows);
}
function visible(row: CurrentForum | undefined, bucket: VisibilityBucket): row is CurrentForum {
	return (
		!!row &&
		row.status === 1 &&
		canViewForumVisibility(row.visibility, bucketToVisibilityContext(bucket))
	);
}
export async function forumCacheKey(env: Env, d: CacheDescriptor): Promise<string> {
	const bucket = d.params.bucket;
	if (
		!["anon", "member", "staff", "admin"].includes(String(bucket)) ||
		d.scope !== `role:${bucket}` ||
		Object.keys(d.params).length !== 1
	)
		throw new TypeError("Invalid forum cache descriptor");
	if (d.family === "forum:tree:v2")
		return forumTreeKey(bucket as VisibilityBucket, await getGen(env, forumTreeGenKey()));
	if (d.family === "forum:summary:v2")
		return forumSummaryKey(bucket as VisibilityBucket, await getGen(env, forumSummaryGenKey()));
	throw new TypeError("Unsupported forum cache family");
}
export function isForumCacheData(d: CacheDescriptor, value: unknown): boolean {
	if (d.family === "forum:tree:v2")
		return (
			isForumTreePayload(value) &&
			value.bucket === d.params.bucket &&
			value.forums.every(
				(row) =>
					Number.isSafeInteger(row.id) &&
					row.id > 0 &&
					typeof row.name === "string" &&
					typeof row.moderatorIds === "string" &&
					Array.isArray(row.moderatorList),
			)
		);
	return (
		d.family === "forum:summary:v2" &&
		isForumSummaryPayload(value) &&
		value.bucket === d.params.bucket &&
		Object.values(value.aggregates).every((row) =>
			[row.threads, row.posts, row.todayThreads, row.lastThreadId].every(Number.isFinite),
		)
	);
}
export async function rebuildForumCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<ForumTreePayloadV2 | ForumSummaryPayloadV2> {
	await forumCacheKey(env, d);
	const bucket = d.params.bucket as VisibilityBucket;
	return d.family === "forum:tree:v2"
		? buildForumTreePayload(await loadForumStructure(env), bucket)
		: buildForumSummaryPayload(await loadForumSnapshot(env), bucket);
}
export async function getForumTreeV2(
	env: Env,
	ctx: ExecutionContext | undefined,
	bucket: VisibilityBucket,
	_loadSnapshot?: () => Promise<ForumSnapshotRow[]>,
	checked?: Map<number, CurrentForum>,
): Promise<ForumTreeNodeV2[]> {
	const d = { family: "forum:tree:v2", params: { bucket }, scope: `role:${bucket}` };
	const [key, current] = await Promise.all([forumCacheKey(env, d), checked ?? currentForums(env)]);
	const payload = await cacheGetOrSet(
		env,
		ctx,
		key,
		async () => buildForumTreePayload(await loadForumStructure(env), bucket),
		{
			...d,
			tier: "HOUR",
			validator: (value): value is ForumTreePayloadV2 => isForumCacheData(d, value),
		},
	);
	const nodes = payload.forums.flatMap((node) => {
		const row = current.get(node.id);
		return visible(row, bucket) ? [{ node, row }] : [];
	});
	const minis = await getUserProfiles(
		env,
		ctx,
		nodes.flatMap(({ row }) => parseModeratorIds(row.moderator_ids)),
	);
	return nodes.map(({ node, row }) => ({
		...node,
		parentId: row.parent_id,
		status: row.status,
		visibility: row.visibility,
		moderators: row.moderators,
		moderatorIds: row.moderator_ids,
		moderatorList: parseModeratorIds(row.moderator_ids).flatMap((id) => {
			const user = minis.get(id);
			return user ? [{ id, name: user.username }] : [];
		}),
		threadTypes: {
			enabled: row.thread_types_enabled === 1,
			required: row.thread_types_required === 1,
			listable: row.thread_types_listable === 1,
			prefix: row.thread_types_prefix === 1,
		},
	}));
}
interface Candidate {
	id: number;
	forum_id: number;
	sticky: number;
	anonymous_last_poster: number;
}
async function currentCandidates(env: Env, ids: number[]): Promise<Map<number, Candidate>> {
	if (!ids.length) return new Map();
	const version = await getGen(env, forumSummaryGenKey());
	const cacheable = canCacheGates(env, version, "forum:summary:v2");
	const key = [...ids].sort((a, b) => a - b).join(",");
	let snapshots = latestGates.get(env.KV);
	const cached = snapshots?.get(key);
	if (cacheable && cached?.version === version && cached.expiresAt > Date.now())
		return new Map(cached.rows);
	const rows = new Map<number, Candidate>();
	for (let start = 0; start < ids.length; start += 100) {
		const part = ids.slice(start, start + 100);
		const result = await env.DB.prepare(
			`SELECT id, forum_id, sticky, anonymous_last_poster FROM threads WHERE id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<Candidate>();
		if (!result.success) throw new Error("Current last-thread permissions could not be loaded");
		for (const row of result.results) rows.set(row.id, row);
	}
	if (cacheable) {
		if (!snapshots) {
			snapshots = new Map();
			latestGates.set(env.KV, snapshots);
		}
		if (snapshots.size >= 32) snapshots.clear();
		snapshots.set(key, { version, expiresAt: Date.now() + FORUM_SUMMARY_TTL * 1000, rows });
	}
	return new Map(rows);
}
async function replaceMissingCandidates(
	env: Env,
	aggregates: Record<number, ForumAggregateV2>,
	gates: Map<number, Candidate>,
): Promise<void> {
	const missing = Object.entries(aggregates)
		.filter(([id, row]) => {
			const gate = gates.get(row.lastThreadId);
			return row.lastThreadId > 0 && (!gate || gate.forum_id !== Number(id) || gate.sticky < 0);
		})
		.map(([id]) => Number(id));
	for (let start = 0; start < missing.length; start += 100) {
		const part = missing.slice(start, start + 100);
		const result = await env.DB.prepare(
			`SELECT f.id, ${LAST_THREAD_COLUMNS} FROM forums f ${LAST_THREAD_JOINS} WHERE f.id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<Record<string, unknown>>();
		if (!result.success) throw new Error("Visible last-thread fallback could not be loaded");
		for (const id of part) aggregates[id] = { ...aggregates[id], ...lastThreadFields({}) };
		for (const row of result.results) {
			const id = Number(row.id);
			aggregates[id] = { ...aggregates[id], ...lastThreadFields(row) };
		}
		const replacements = await currentCandidates(
			env,
			result.results.flatMap((row) => (row.last_thread_id ? [Number(row.last_thread_id)] : [])),
		);
		for (const [id, row] of replacements) gates.set(id, row);
	}
}
function composeLastThread(
	aggregate: ForumAggregateV2,
	gate: Candidate | undefined,
): ForumAggregateV2 {
	if (!gate || gate.sticky < 0) return { ...aggregate, ...lastThreadFields({}) };
	if (gate.anonymous_last_poster !== 1) return aggregate;
	return {
		...aggregate,
		lastPoster: ANONYMOUS_AUTHOR_NAME,
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
	};
}
export async function getForumSummaryV2(
	env: Env,
	ctx: ExecutionContext | undefined,
	bucket: VisibilityBucket,
	loadSnapshot = () => loadForumSnapshot(env),
	checked?: Map<number, CurrentForum>,
): Promise<Record<number, ForumAggregateV2>> {
	const d = { family: "forum:summary:v2", params: { bucket }, scope: `role:${bucket}` };
	const [key, current] = await Promise.all([forumCacheKey(env, d), checked ?? currentForums(env)]);
	const payload = await cacheGetOrSet(
		env,
		ctx,
		key,
		async () => buildForumSummaryPayload(await loadSnapshot(), bucket),
		{
			...d,
			tier: "HOUR",
			validator: (value): value is ForumSummaryPayloadV2 => isForumCacheData(d, value),
		},
	);
	const aggregates = Object.fromEntries(
		Object.entries(payload.aggregates).filter(([id]) => visible(current.get(Number(id)), bucket)),
	) as Record<number, ForumAggregateV2>;
	const ids = () => [
		...new Set(
			Object.values(aggregates)
				.map((row) => row.lastThreadId)
				.filter((id) => id > 0),
		),
	];
	const gates = await currentCandidates(env, ids());
	await replaceMissingCandidates(env, aggregates, gates);
	return Object.fromEntries(
		Object.entries(aggregates).map(([id, agg]) => [
			id,
			composeLastThread(agg, gates.get(agg.lastThreadId)),
		]),
	);
}
export async function getForums(
	env: Env,
	ctx: ExecutionContext | undefined,
	bucket: VisibilityBucket,
): Promise<Forum[]> {
	const current = await currentForums(env);
	const [tree, summary] = await Promise.all([
		getForumTreeV2(env, ctx, bucket, undefined, current),
		getForumSummaryV2(env, ctx, bucket, undefined, current),
	]);
	return mergeTreeAndSummary(tree, summary);
}
export function mergeTreeAndSummary(
	tree: ForumTreeNodeV2[],
	aggregates: Record<number, ForumAggregateV2>,
): Forum[] {
	const out: Forum[] = new Array(tree.length);
	for (let i = 0; i < tree.length; i++) {
		const node = tree[i];
		const agg = aggregates[node.id];
		out[i] = {
			id: node.id,
			parentId: node.parentId,
			name: node.name,
			description: node.description,
			announcement: node.announcement,
			icon: node.icon,
			displayOrder: node.displayOrder,
			type: node.type,
			status: node.status,
			visibility: node.visibility,
			moderators: node.moderators,
			moderatorList: node.moderatorList,
			threads: agg?.threads ?? 0,
			posts: agg?.posts ?? 0,
			todayThreads: agg?.todayThreads ?? 0,
			lastThreadId: agg?.lastThreadId ?? 0,
			lastThreadSubject: agg?.lastThreadSubject ?? "",
			lastPostAt: agg?.lastPostAt ?? 0,
			lastPoster: agg?.lastPoster ?? "",
			lastPosterId: agg?.lastPosterId ?? 0,
			lastPosterAvatar: agg?.lastPosterAvatar ?? "",
			lastPosterAvatarPath: agg?.lastPosterAvatarPath ?? "",
			threadTypes: node.threadTypes,
		};
	}
	return out;
}

export type ForumMetaResult =
	| { kind: "ok"; forum: Forum }
	| { kind: "notFound" }
	| { kind: "forbidden" };
export async function getForumMetaV2(
	env: Env,
	ctx: ExecutionContext | undefined,
	forumId: number,
	bucket: VisibilityBucket,
): Promise<ForumMetaResult> {
	const current = await currentForums(env);
	const row = current.get(forumId);
	if (row?.status !== 1) return { kind: "notFound" };
	if (!visible(row, bucket)) return { kind: "forbidden" };
	const [tree, summary] = await Promise.all([
		getForumTreeV2(env, ctx, bucket, undefined, current),
		getForumSummaryV2(env, ctx, bucket, undefined, current),
	]);
	const forum = mergeTreeAndSummary(
		tree.filter((node) => node.id === forumId),
		summary,
	)[0];
	return forum ? { kind: "ok", forum } : { kind: "notFound" };
}
