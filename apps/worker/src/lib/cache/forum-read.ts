// Structural LONG snapshots and SHORT counters/membership compose at response time.
// Current forum/thread gates run even on hot data; no combined snapshot renews TTL.
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
import { getGen } from "./epoch";
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
import { getThreadRows, type ReadingRow } from "./thread-loaders";
import { cacheGetOrSet } from "./wrap";

export const FORUM_TREE_TTL = CACHE_TTL_SECONDS.LONG;
export const FORUM_SUMMARY_TTL = CACHE_TTL_SECONDS.SHORT;
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
	"(SELECT t.id FROM threads t WHERE t.forum_id = f.id AND t.sticky >= 0 ORDER BY t.last_post_at DESC, t.id DESC LIMIT 1)";
export async function loadForumSnapshot(env: Env): Promise<ForumSnapshotRow[]> {
	const cutoff = Math.floor(Date.now() / 1000) - 86400;
	const [forums, counts] = await Promise.all([
		env.DB.prepare(
			`SELECT f.id, f.status, f.visibility, f.threads, f.posts, ${LAST_ID} AS last_thread_id FROM forums f`,
		).all<Record<string, unknown>>(),
		env.DB.prepare(
			"SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? AND sticky >= 0 GROUP BY forum_id",
		)
			.bind(cutoff)
			.all<{ forum_id: number; cnt: number }>(),
	]);
	if (!forums.success || !counts.success) throw new Error("Forum summary could not be loaded");
	const today = new Map(counts.results.map((row) => [row.forum_id, row.cnt]));
	return forums.results.map((row) => ({
		...snapshot({ ...row, last_thread_id: row.last_thread_id ?? 0 }),
		todayThreads: today.get(Number(row.id)) ?? 0,
	}));
}
export function lazyForumSnapshot(env: Env): () => Promise<ForumSnapshotRow[]> {
	let task: Promise<ForumSnapshotRow[]> | undefined;
	return () => (task ??= loadForumSnapshot(env));
}
async function currentForums(env: Env): Promise<Map<number, CurrentForum>> {
	const result = await env.DB.prepare(
		`SELECT id, parent_id, status, visibility, moderators, moderator_ids, thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix FROM forums`,
	).all<CurrentForum>();
	if (!result.success) throw new Error("Current forum permissions could not be loaded");
	return new Map(result.results.map((row) => [row.id, row]));
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
			tier: "LONG",
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
	return rows;
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
			`SELECT f.id, ${LAST_ID} AS thread_id FROM forums f WHERE f.id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<{ id: number; thread_id: number | null }>();
		if (!result.success) throw new Error("Visible last-thread fallback could not be loaded");
		for (const id of part) aggregates[id].lastThreadId = 0;
		for (const row of result.results) aggregates[row.id].lastThreadId = row.thread_id ?? 0;
		const replacements = await currentCandidates(
			env,
			result.results.flatMap((row) => (row.thread_id ? [row.thread_id] : [])),
		);
		for (const [id, row] of replacements) gates.set(id, row);
	}
}
function composeLastThread(
	aggregate: ForumAggregateV2,
	row: ReadingRow | undefined,
	gate: Candidate | undefined,
	minis: Awaited<ReturnType<typeof getUserProfiles>>,
): ForumAggregateV2 {
	if (!row || !gate || gate.sticky < 0)
		return {
			...aggregate,
			lastThreadId: 0,
			lastThreadSubject: "",
			lastPostAt: 0,
			lastPoster: "",
			lastPosterId: 0,
			lastPosterAvatar: "",
			lastPosterAvatarPath: "",
		};
	const anonymous = row.anonymous_last_poster === 1 || gate.anonymous_last_poster === 1;
	const userId = Number(row.last_poster_id ?? 0);
	const user = !anonymous ? minis.get(userId) : undefined;
	return {
		...aggregate,
		lastThreadSubject: String(row.subject),
		lastPostAt: Number(row.last_post_at ?? 0),
		lastPoster: anonymous
			? ANONYMOUS_AUTHOR_NAME
			: (user?.username ?? String(row.last_poster ?? "")),
		lastPosterId: anonymous ? 0 : userId,
		lastPosterAvatar: user?.avatar ?? "",
		lastPosterAvatarPath: user?.avatarPath ?? "",
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
			tier: "SHORT",
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
	const rows = await getThreadRows(env, ctx, ids());
	const minis = await getUserProfiles(
		env,
		ctx,
		[...rows.values()]
			.filter(
				(row) =>
					row.anonymous_last_poster !== 1 && gates.get(Number(row.id))?.anonymous_last_poster !== 1,
			)
			.map((row) => Number(row.last_poster_id ?? 0)),
	);
	return Object.fromEntries(
		Object.entries(aggregates).map(([id, agg]) => [
			id,
			composeLastThread(agg, rows.get(agg.lastThreadId), gates.get(agg.lastThreadId), minis),
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
