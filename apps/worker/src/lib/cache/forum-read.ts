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
 * One enriched D1 row. Combines the `forums` table (incl. `moderator_ids`),
 * a LEFT JOIN on `users` for the last-poster avatar fields, the moderator
 * name list, and the today-thread count. Both tree and summary builders are
 * fed this same row shape so a single D1 fetch can satisfy both.
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
 */
export async function loadForumSnapshot(env: Env): Promise<ForumSnapshotRow[]> {
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

	// JOIN users to get the last-poster avatar inline; this avoids a second
	// round-trip to user:mini and matches the legacy non-KV-user-cache path.
	const forumQuery = `
		SELECT f.*, u.avatar AS last_poster_avatar, u.avatar_path AS last_poster_avatar_path
		FROM forums f
		LEFT JOIN users u ON f.last_poster_id = u.id
		ORDER BY f.display_order
	`;

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

	// Collect moderator IDs across all forums for one batched name lookup.
	const rawRows = forumResult.results as Record<string, unknown>[];
	const allModIds = new Set<number>();
	const perRowModIds: number[][] = new Array(rawRows.length);
	for (let i = 0; i < rawRows.length; i++) {
		const ids = parseModeratorIds(((rawRows[i].moderator_ids as string) ?? "") || "");
		perRowModIds[i] = ids;
		for (const id of ids) allModIds.add(id);
	}

	let modNameMap = new Map<number, string>();
	if (allModIds.size > 0) {
		const ids = [...allModIds];
		const placeholders = ids.map(() => "?").join(",");
		const result = await env.DB.prepare(
			`SELECT id, username FROM users WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.all<{ id: number; username: string }>();
		modNameMap = new Map(result.results.map((r) => [r.id, r.username]));
	}

	const out: ForumSnapshotRow[] = new Array(rawRows.length);
	for (let i = 0; i < rawRows.length; i++) {
		const r = rawRows[i] as Record<string, unknown>;
		const id = r.id as number;
		const moderatorIdsStr = (r.moderator_ids as string) ?? "";
		const moderatorList: ModeratorInfo[] = [];
		for (const mid of perRowModIds[i]) {
			const name = modNameMap.get(mid);
			if (name) moderatorList.push({ id: mid, name });
		}
		out[i] = {
			id,
			parentId: r.parent_id as number,
			name: r.name as string,
			description: r.description as string,
			icon: r.icon as string,
			displayOrder: r.display_order as number,
			threads: r.threads as number,
			posts: r.posts as number,
			type: r.type as Forum["type"],
			status: r.status as number,
			visibility: ((r.visibility as string) || "public") as ForumVisibility,
			moderators: (r.moderators as string) ?? "",
			moderatorIds: moderatorIdsStr,
			moderatorList,
			todayThreads: todayMap.get(id) ?? 0,
			lastThreadId: r.last_thread_id as number,
			lastPostAt: r.last_post_at as number,
			lastPoster: r.last_poster as string,
			lastPosterId: (r.last_poster_id as number | null) ?? 0,
			lastPosterAvatar: ((r.last_poster_avatar as string | undefined) ?? "") || "",
			lastPosterAvatarPath: ((r.last_poster_avatar_path as string | undefined) ?? "") || "",
			lastThreadSubject: r.last_thread_subject as string,
		};
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
		{ ttl: FORUM_TREE_TTL, validator: isForumTreePayload },
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
		{ ttl: FORUM_SUMMARY_TTL, validator: isForumSummaryPayload },
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
	// payload to write back.
	try {
		const cached = (await env.KV.get(key, "json")) as unknown;
		if (cached !== null && cached !== undefined && isForumMetaPayload(cached)) {
			return { kind: "ok", forum: cached.forum };
		}
	} catch {
		// Fall through.
	}

	// Miss path: load full forum row from D1.
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
	}).catch(() => {});
	ctx.waitUntil(putPromise);

	return { kind: "ok", forum: payload.forum };
}

// ─── Local helpers ────────────────────────────────────────────────

// Re-export the bumpGen helper at module scope so test mocks can stub it via
// the same module they import the readers from.
export { bumpGen };
