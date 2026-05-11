// Forum v2 read-path glue. Sits between the pure builders/validators in
// `lib/cache/forum.ts` and the public read handlers in `handlers/forum.ts`.
//
// Responsibilities:
//   - Resolve `forum:tree:gen` / `forum:summary:gen` once per request.
//   - Drive `cacheGetOrSet` for tree / summary / meta keys, lazy per bucket.
//   - Provide a *request-local* full-forum snapshot promise so a cold-start
//     (tree miss + summary miss in the same request) hits D1 only ONCE.
//   - Feed builders enriched rows that already carry `lastPosterAvatar` /
//     `lastPosterAvatarPath` so cache HITS never need user:mini / D1.
//
// This module owns IO. The pure module `forum.ts` does not.

import {
	type Forum,
	type ForumVisibility,
	type ModeratorInfo,
	canViewForumVisibility,
} from "@ellie/types";
import type { Env } from "../env";
import { parseModeratorIds } from "../mappers";
import { THREAD_VISIBLE, isForumActive } from "../visibility";
import { bumpGen, getGen } from "./epoch";
import {
	type ForumAggregateV2,
	type ForumMetaPayloadV2,
	type ForumSummaryPayloadV2,
	type ForumTreeNodeV2,
	type ForumTreePayloadV2,
	bucketToVisibilityContext,
	buildForumMetaPayload,
	buildForumSummaryPayload,
	buildForumTreePayload,
	isForumMetaPayload,
	isForumSummaryPayload,
	isForumTreePayload,
} from "./forum";
import {
	type VisibilityBucket,
	forumMetaKey,
	forumSummaryGenKey,
	forumSummaryKey,
	forumTreeGenKey,
	forumTreeKey,
} from "./keys";
import {
	recordError,
	recordHit,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
} from "./metrics";
import { cacheGetOrSet } from "./wrap";

// ─── TTLs (docs/19 §4) ────────────────────────────────────────────

/** Structural tree — long TTL, correctness from `forum:tree:gen`. */
export const FORUM_TREE_TTL = 86_400; // 24h
/** Aggregates incl. last-poster avatar — short TTL, correctness from `forum:summary:gen`. */
export const FORUM_SUMMARY_TTL = 600; // 10min
/** Single-forum view — same gen as summary; 10min. */
export const FORUM_META_TTL = 600; // 10min

// ─── Snapshot row (D1) ────────────────────────────────────────────

/**
 * One enriched D1 row. Combines the `forums` table (incl. `moderator_ids`)
 * with the visible-last-thread override (sticky >= 0), the moderator
 * name list, the today-thread count, and the visible last poster's
 * avatar (resolved from `users` keyed by the *visible* poster id, NOT
 * `forums.last_poster_id`). Both tree and summary builders are fed this
 * same row shape so a single D1 fetch can satisfy both.
 */
export interface ForumSnapshotRow extends Forum {
	/** Comma-separated moderator user IDs (preserved verbatim from D1). */
	moderatorIds: string;
}

// ─── Snapshot loader ──────────────────────────────────────────────

/**
 * Fetch the full forum row set + per-forum today count + moderator names +
 * last-poster avatar in as few D1 round-trips as possible. This is the
 * single source of truth for both `buildForumTreePayload` and
 * `buildForumSummaryPayload`; cold-start of a request that misses both
 * caches will run this loader exactly once.
 *
 * Applies a visible-last-thread override on top of the raw `forums`
 * row: the raw `forums.last_thread_*` columns can point at a hidden /
 * recycled thread (sticky < 0). For each forum we batch-query the most
 * recent VISIBLE thread (sticky >= 0) and override the last-thread /
 * last-poster fields with that, including a separate avatar lookup
 * keyed by the visible last-poster id (which may differ from
 * `forums.last_poster_id`). Forums with no visible thread get all
 * last-* + avatar fields cleared.
 */
export async function loadForumSnapshot(env: Env): Promise<ForumSnapshotRow[]> {
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

	// We deliberately DO NOT JOIN users for the last-poster avatar here:
	// the visible-last-thread override (below) may point at a different
	// user than `forums.last_poster_id`, so the JOIN'd avatar would be
	// stale. Avatars are fetched in a second batched lookup keyed by
	// the *visible* last-poster ids.
	const forumQuery = "SELECT * FROM forums ORDER BY display_order";

	const [forumResult, countResult] = await Promise.all([
		env.DB.prepare(forumQuery).all(),
		env.DB.prepare(
			`SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? AND ${THREAD_VISIBLE} GROUP BY forum_id`,
		)
			.bind(cutoff24h)
			.all<{ forum_id: number; cnt: number }>(),
	]);

	const todayMap = new Map<number, number>();
	for (const row of countResult.results) {
		todayMap.set(row.forum_id, row.cnt);
	}

	const rawRows = forumResult.results as Record<string, unknown>[];
	const { allModIds, perRowModIds, forumIds } = collectRowIds(rawRows);

	// Visible-last-thread per forum (sticky >= 0). Mirrors
	// `fetchVisibleLastThreads` in handlers/forum.ts.
	const visibleLastByForum = await fetchVisibleLastThreadsForSnapshot(env, forumIds);

	const avatarIds = new Set<number>();
	for (const v of visibleLastByForum.values()) {
		if (v.lastPosterId > 0) avatarIds.add(v.lastPosterId);
	}

	const { modNameMap, avatarMap } = await loadUserMaps(env, allModIds, avatarIds);

	const out: ForumSnapshotRow[] = new Array(rawRows.length);
	for (let i = 0; i < rawRows.length; i++) {
		out[i] = buildSnapshotRow(rawRows[i], {
			modIds: perRowModIds[i],
			modNameMap,
			visible: visibleLastByForum.get((rawRows[i] as Record<string, unknown>).id as number),
			avatarMap,
			todayMap,
		});
	}
	return out;
}

interface RowIdCollectResult {
	allModIds: Set<number>;
	perRowModIds: number[][];
	forumIds: number[];
}

function collectRowIds(rawRows: Record<string, unknown>[]): RowIdCollectResult {
	const allModIds = new Set<number>();
	const perRowModIds: number[][] = new Array(rawRows.length);
	const forumIds: number[] = new Array(rawRows.length);
	for (let i = 0; i < rawRows.length; i++) {
		const r = rawRows[i];
		const ids = parseModeratorIds(((r.moderator_ids as string) ?? "") || "");
		perRowModIds[i] = ids;
		for (const id of ids) allModIds.add(id);
		forumIds[i] = r.id as number;
	}
	return { allModIds, perRowModIds, forumIds };
}

interface UserMaps {
	modNameMap: Map<number, string>;
	avatarMap: Map<number, { avatar: string; avatarPath: string }>;
}

async function loadUserMaps(
	env: Env,
	modIds: Set<number>,
	avatarIds: Set<number>,
): Promise<UserMaps> {
	const modNameMap = new Map<number, string>();
	const avatarMap = new Map<number, { avatar: string; avatarPath: string }>();
	if (modIds.size === 0 && avatarIds.size === 0) return { modNameMap, avatarMap };

	const idUnion = new Set<number>([...modIds, ...avatarIds]);
	const ids = [...idUnion];

	// SQLite caps prepared-statement variables at 999. Forums + moderators +
	// last-posters can plausibly exceed that on a large board, so chunk the
	// IN-list into BATCH_SIZE-element windows that stay well under the cap.
	const BATCH_SIZE = 100;
	for (let i = 0; i < ids.length; i += BATCH_SIZE) {
		const batch = ids.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");
		const result = await env.DB.prepare(
			`SELECT id, username, avatar, avatar_path FROM users WHERE id IN (${placeholders})`,
		)
			.bind(...batch)
			.all<{ id: number; username: string; avatar: string | null; avatar_path: string | null }>();
		for (const row of result.results) {
			if (modIds.has(row.id)) modNameMap.set(row.id, row.username);
			if (avatarIds.has(row.id)) {
				avatarMap.set(row.id, {
					avatar: row.avatar ?? "",
					avatarPath: row.avatar_path ?? "",
				});
			}
		}
	}
	return { modNameMap, avatarMap };
}

interface BuildRowCtx {
	modIds: number[];
	modNameMap: Map<number, string>;
	visible: VisibleLastThreadRow | undefined;
	avatarMap: Map<number, { avatar: string; avatarPath: string }>;
	todayMap: Map<number, number>;
}

function buildSnapshotRow(raw: Record<string, unknown>, ctx: BuildRowCtx): ForumSnapshotRow {
	const id = raw.id as number;
	const moderatorIdsStr = (raw.moderator_ids as string) ?? "";
	const moderatorList: ModeratorInfo[] = [];
	for (const mid of ctx.modIds) {
		const name = ctx.modNameMap.get(mid);
		if (name) moderatorList.push({ id: mid, name });
	}

	// Apply visible-last-thread override. If no visible thread exists,
	// all last-* + avatar fields default to cleared values (no
	// last-thread / last-poster shown for that forum).
	const v = ctx.visible;
	const av = v ? ctx.avatarMap.get(v.lastPosterId) : undefined;

	return {
		id,
		parentId: raw.parent_id as number,
		name: raw.name as string,
		description: raw.description as string,
		icon: raw.icon as string,
		displayOrder: raw.display_order as number,
		threads: raw.threads as number,
		posts: raw.posts as number,
		type: raw.type as Forum["type"],
		status: raw.status as number,
		visibility: ((raw.visibility as string) || "public") as ForumVisibility,
		moderators: (raw.moderators as string) ?? "",
		moderatorIds: moderatorIdsStr,
		moderatorList,
		todayThreads: ctx.todayMap.get(id) ?? 0,
		lastThreadId: v?.threadId ?? 0,
		lastPostAt: v?.lastPostAt ?? 0,
		lastPoster: v?.lastPoster ?? "",
		lastPosterId: v?.lastPosterId ?? 0,
		lastPosterAvatar: av?.avatar ?? "",
		lastPosterAvatarPath: av?.avatarPath ?? "",
		lastThreadSubject: v?.subject ?? "",
	};
}

interface VisibleLastThreadRow {
	threadId: number;
	subject: string;
	lastPostAt: number;
	lastPosterId: number;
	lastPoster: string;
}

/**
 * Snapshot-local copy of `fetchVisibleLastThreads` from handlers/forum.ts.
 * Kept private here so the cache module owns its own IO and stays
 * decoupled from the handler module.
 */
async function fetchVisibleLastThreadsForSnapshot(
	env: Env,
	forumIds: number[],
): Promise<Map<number, VisibleLastThreadRow>> {
	const out = new Map<number, VisibleLastThreadRow>();
	if (forumIds.length === 0) return out;

	const BATCH_SIZE = 100; // SQLite var limit guard
	for (let i = 0; i < forumIds.length; i += BATCH_SIZE) {
		const batch = forumIds.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");
		const res = await env.DB.prepare(
			`SELECT t.forum_id, t.id as thread_id, t.subject, t.last_post_at, t.last_poster_id, t.last_poster
			 FROM threads t
			 INNER JOIN (
				 SELECT forum_id, MAX(last_post_at) as max_post_at
				 FROM threads
				 WHERE forum_id IN (${placeholders}) AND sticky >= 0
				 GROUP BY forum_id
			 ) sub ON t.forum_id = sub.forum_id AND t.last_post_at = sub.max_post_at
			 WHERE t.sticky >= 0
			 ORDER BY t.last_post_at DESC, t.id DESC`,
		)
			.bind(...batch)
			.all<{
				forum_id: number;
				thread_id: number;
				subject: string;
				last_post_at: number;
				last_poster_id: number;
				last_poster: string;
			}>();
		for (const row of res.results) {
			if (!out.has(row.forum_id)) {
				out.set(row.forum_id, {
					threadId: row.thread_id,
					subject: row.subject,
					lastPostAt: row.last_post_at,
					lastPosterId: row.last_poster_id,
					lastPoster: row.last_poster,
				});
			}
		}
	}
	return out;
}

/**
 * Wrap a loader so it's invoked at most once per request. Both tree and
 * summary `cacheGetOrSet` loaders share the same lazy promise — the second
 * call resolves to the same snapshot without touching D1 again.
 */
export function lazyForumSnapshot(env: Env): () => Promise<ForumSnapshotRow[]> {
	let p: Promise<ForumSnapshotRow[]> | null = null;
	return () => {
		if (!p) p = loadForumSnapshot(env);
		return p;
	};
}

// ─── Tree / Summary readers ───────────────────────────────────────

/** Read `forum:tree:v2:<bucket>:g<gen>`, building only this bucket on miss. */
export async function getForumTreeV2(
	env: Env,
	ctx: ExecutionContext,
	bucket: VisibilityBucket,
	loadSnapshot: () => Promise<ForumSnapshotRow[]>,
): Promise<ForumTreeNodeV2[]> {
	const gen = await getGen(env, forumTreeGenKey());
	const key = forumTreeKey(bucket, gen);
	const payload = await cacheGetOrSet<ForumTreePayloadV2>(
		env,
		ctx,
		key,
		async () => {
			const snapshot = await loadSnapshot();
			return buildForumTreePayload(snapshot, bucket);
		},
		{ ttl: FORUM_TREE_TTL, validator: isForumTreePayload, family: "forum:tree:v2" },
	);
	return payload.forums;
}

/** Read `forum:summary:v2:<bucket>:g<gen>`, building only this bucket on miss. */
export async function getForumSummaryV2(
	env: Env,
	ctx: ExecutionContext,
	bucket: VisibilityBucket,
	loadSnapshot: () => Promise<ForumSnapshotRow[]>,
): Promise<Record<number, ForumAggregateV2>> {
	const gen = await getGen(env, forumSummaryGenKey());
	const key = forumSummaryKey(bucket, gen);
	const payload = await cacheGetOrSet<ForumSummaryPayloadV2>(
		env,
		ctx,
		key,
		async () => {
			const snapshot = await loadSnapshot();
			return buildForumSummaryPayload(snapshot, bucket);
		},
		{ ttl: FORUM_SUMMARY_TTL, validator: isForumSummaryPayload, family: "forum:summary:v2" },
	);
	return payload.aggregates;
}

/**
 * Merge a tree node + bucket-filtered aggregate into a public `Forum` shape
 * (the response contract for `GET /api/v1/forums`). Forums with no aggregate
 * (e.g. brand-new forum that hasn't been re-snapshotted yet) are still
 * returned with zeroed aggregate fields, matching the legacy behaviour.
 */
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
		};
	}
	return out;
}

// ─── Meta reader ──────────────────────────────────────────────────

/**
 * Three-state outcome for the v2 `getById` path. Callers translate these to
 * HTTP responses; `notFound` and `forbidden` MUST NOT write KV.
 */
export type ForumMetaResult =
	| { kind: "ok"; forum: Forum }
	| { kind: "notFound" }
	| { kind: "forbidden" };

/**
 * Resolve a single-forum v2 view for `(forumId, bucket)`.
 *
 * Order:
 *   1. cache get on `forum:meta:v2:<id>:<bucket>:g<gen>`.
 *   2. miss → re-read raw row from D1 (NOT cached) so we can distinguish:
 *        - row missing OR `!isForumActive`  → 404, no KV write
 *        - row visible to bucket failed     → 403, no KV write
 *        - otherwise build full payload and write KV.
 *   3. hit → 0 SQL.
 *
 * We deliberately DO NOT route 403/404 through `buildForumMetaPayload(null)`
 * because that helper returns `null` for both — the explicit row probe is
 * the only way to keep the "not found" vs. "forbidden" distinction.
 */
export async function getForumMetaV2(
	env: Env,
	ctx: ExecutionContext,
	forumId: number,
	bucket: VisibilityBucket,
	loadFullForum: () => Promise<Forum | null>,
): Promise<ForumMetaResult> {
	const gen = await getGen(env, forumSummaryGenKey());
	const key = forumMetaKey(forumId, bucket, gen);

	// Try cache directly (read-only). We don't use `cacheGetOrSet` here
	// because the miss path needs to short-circuit to 404/403 without a
	// payload to write back. Read/hit/miss/error are still tracked under
	// the `forum:meta:v2` family so the admin monitor sees this path.
	recordRead("forum:meta:v2");
	try {
		const cached = (await env.KV.get(key, "json")) as unknown;
		if (cached !== null && cached !== undefined && isForumMetaPayload(cached)) {
			recordHit("forum:meta:v2");
			scheduleMetricsFlush(env, ctx);
			return { kind: "ok", forum: cached.forum };
		}
	} catch (err) {
		// Fall through.
		recordError("forum:meta:v2");
		console.warn(`[cache] forum:meta read failed key=${key}`, err);
	}

	// Miss path: load full forum row from D1.
	recordMiss("forum:meta:v2");
	const forum = await loadFullForum();
	if (forum == null) return { kind: "notFound" };
	if (!isForumActive(forum)) return { kind: "notFound" };
	if (!canViewForumVisibility(forum.visibility, bucketToVisibilityContext(bucket))) {
		return { kind: "forbidden" };
	}

	const payload: ForumMetaPayloadV2 | null = buildForumMetaPayload(forum, bucket);
	if (payload == null) {
		// Defence in depth: builder agrees this isn't cacheable.
		return { kind: "forbidden" };
	}

	// Best-effort write-back; never block the response.
	const putPromise = env.KV.put(key, JSON.stringify(payload), {
		expirationTtl: FORUM_META_TTL,
	})
		.then(() => {
			recordWrite("forum:meta:v2");
		})
		.catch((err) => {
			recordError("forum:meta:v2");
			console.warn(`[cache] forum:meta write-back failed key=${key}`, err);
		});
	ctx.waitUntil(putPromise);
	scheduleMetricsFlush(env, ctx);

	return { kind: "ok", forum: payload.forum };
}

// ─── Local helpers ────────────────────────────────────────────────

// Re-export the bumpGen helper at module scope so test mocks can stub it via
// the same module they import the readers from.
export { bumpGen };
