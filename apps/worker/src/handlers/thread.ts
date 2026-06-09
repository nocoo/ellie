// Thread handlers for Cloudflare Worker

import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { canViewForumVisibility, decodeGenericCursor, type Thread } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import { getForumMetaV2 } from "../lib/cache/forum-read";
import { invalidateForumVolatileV2 } from "../lib/cache/invalidate";
import {
	getThreadListPageOneV2,
	isCacheableLimit,
	isPage1,
	type ThreadListPayloadV2,
} from "../lib/cache/thread-list-read";
import { applyCensorFilter } from "../lib/censor";
import { type Env, isKvUserCacheEnabled } from "../lib/env";
import { ANONYMOUS_AUTHOR_NAME, enrichThreadsWithUserCache, toThread } from "../lib/mappers";
import { buildNextCursor, clampLimit } from "../lib/pagination";
import { checkPostingPermission } from "../lib/postingPermission";
import { getQueryParam } from "../lib/queryString";
import { jsonListResponse, jsonResponse, paginatedResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { incrementStatsOnThreadCreate } from "../lib/stats-counter";
import { scheduleThreadViewIncrement } from "../lib/thread-views";
import { coerceTypeIdInput, resolveAndValidateTypeId } from "../lib/threadType";
import { getUserProfiles } from "../lib/user-cache";
import {
	buildVisibilityContext,
	canReadThreadContent,
	canViewModeratedThread,
	isForumActive,
	STICKY_GLOBAL,
	STICKY_MODERATED,
	THREAD_VISIBLE,
	threadVisible,
} from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";
import { loadFullForumFromD1 } from "./forum";

/** Thread cursor payload for keyset pagination */
interface ThreadCursorPayload {
	sticky: number;
	lastPostAt: number;
	id: number;
}

/** Validate thread cursor payload shape */
function isThreadCursor(p: Partial<ThreadCursorPayload>): boolean {
	return (
		typeof p.sticky === "number" && typeof p.lastPostAt === "number" && typeof p.id === "number"
	);
}

/** D1 row shape for cursor extraction (snake_case) */
interface D1ThreadRow {
	id: number;
	sticky: number;
	last_post_at: number;
}

/** Map an `AuthUser | null` (the optionalAuth shape) onto the
 * `ViewerContext | null` used by the toThread/mapThreadRows masking. */
function toViewer(user: { userId: number; role: number } | null): {
	userId: number;
	role: number;
} | null {
	return user ? { userId: user.userId, role: user.role } : null;
}

/** Map D1 rows to Thread objects with optional avatar enrichment.
 *
 * `viewer` gates anonymous masking: rows with `anonymous_author = 1` have
 * authorId/authorName replaced unless viewer is staff or the author; same
 * for `anonymous_last_poster = 1` on lastPoster*. Exported for unit tests;
 * production callers stay within this module. */
export function mapThreadRows(
	results: unknown[],
	useKvCache: boolean,
	viewer: { userId: number; role: number } | null,
): Thread[] {
	// Inline toThread + avatar fan-out into one allocation per row — avoids
	// a function call and a 4-field post-creation mutation when JOIN data is
	// present. Property order matches toThread() so V8 can keep a single
	// hidden class for both call sites.
	const isStaff = viewer !== null && (viewer.role === 1 || viewer.role === 2 || viewer.role === 3);
	const viewerId = viewer?.userId ?? 0;
	const n = results.length;
	const out = new Array<Thread>(n);
	for (let i = 0; i < n; i++) {
		out[i] = mapOneThreadRow(results[i] as D1ThreadRowLike, useKvCache, isStaff, viewerId);
	}
	return out;
}

/** Per-row mapper extracted so {@link mapThreadRows} stays under the
 * cognitive-complexity ceiling. Inlined call site keeps the V8 hidden-class
 * shape stable. */
function mapOneThreadRow(
	r: D1ThreadRowLike,
	useKvCache: boolean,
	isStaff: boolean,
	viewerId: number,
): Thread {
	const anonAuthor = r.anonymous_author === 1 ? 1 : 0;
	const anonLast = r.anonymous_last_poster === 1 ? 1 : 0;
	const showAuthor = anonAuthor === 0 || isStaff || viewerId === r.author_id;
	const lastPosterId = r.last_poster_id ?? 0;
	const showLast = anonLast === 0 || isStaff || viewerId === lastPosterId;

	// Avatar resolution diverges between fast paths but the masked-author
	// branch always blanks them out. Resolve both pairs once.
	const authorAvatar =
		useKvCache || !showAuthor ? "" : ((r.author_avatar as string | undefined) ?? "");
	const authorAvatarPath =
		useKvCache || !showAuthor ? "" : ((r.author_avatar_path as string | undefined) ?? "");
	const lastPosterAvatar =
		useKvCache || !showLast ? "" : ((r.last_poster_avatar as string | undefined) ?? "");
	const lastPosterAvatarPath =
		useKvCache || !showLast ? "" : ((r.last_poster_avatar_path as string | undefined) ?? "");

	return {
		id: r.id,
		forumId: r.forum_id,
		authorId: showAuthor ? r.author_id : 0,
		authorName: showAuthor ? r.author_name : ANONYMOUS_AUTHOR_NAME,
		authorAvatar,
		authorAvatarPath,
		subject: r.subject,
		createdAt: r.created_at,
		lastPostAt: r.last_post_at,
		lastPoster: showLast ? r.last_poster : ANONYMOUS_AUTHOR_NAME,
		lastPosterId: showLast ? lastPosterId : 0,
		lastPosterAvatar,
		lastPosterAvatarPath,
		replies: r.replies,
		views: r.views,
		closed: r.closed,
		sticky: r.sticky,
		digest: r.digest,
		special: r.special,
		highlight: r.highlight,
		recommends: r.recommends,
		typeName: r.type_name,
		anonymousAuthor: anonAuthor,
		anonymousLastPoster: anonLast,
		isAuthorFirstThread: r.is_author_first_thread === 1,
		// List views do not surface the recommended-card flag — it is only
		// read by the thread-detail mod menu. Default false so the Thread
		// type stays uniform without paying for a per-row EXISTS probe in
		// forum/profile lists.
		isRecommended: false,
	};
}

// Local row shape (mirrors D1ThreadRow used by mappers.toThread). Kept inline
// to avoid an extra import surface; the runtime cast is identical.
interface D1ThreadRowLike {
	id: number;
	forum_id: number;
	author_id: number;
	author_name: string;
	subject: string;
	created_at: number;
	last_post_at: number;
	last_poster: string;
	last_poster_id: number | null;
	replies: number;
	views: number;
	closed: number;
	sticky: number;
	digest: number;
	special: number;
	highlight: number;
	recommends: number;
	type_name: string;
	anonymous_author?: number;
	anonymous_last_poster?: number;
	author_avatar?: string;
	author_avatar_path?: string;
	last_poster_avatar?: string;
	last_poster_avatar_path?: string;
	is_author_first_thread?: number;
}

/** Get thread list query based on cache strategy */
// Pre-compute the four SQL templates produced by getThreadListQuery so we
// don't rebuild them on every request. The shape only depends on two booleans
// (useKvCache, withCursor) so a 2x2 lookup is enough.

/** Correlated subquery: true when no earlier visible thread by the same author exists. */
const IS_AUTHOR_FIRST_THREAD =
	"(CASE WHEN t.author_id > 0 AND NOT EXISTS (SELECT 1 FROM threads t2 WHERE t2.author_id = t.author_id AND t2.sticky >= 0 AND (t2.created_at < t.created_at OR (t2.created_at = t.created_at AND t2.id < t.id))) THEN 1 ELSE 0 END) AS is_author_first_thread";

/**
 * Sort rank for thread lists. Discuz `sticky` values are
 * {0,1,2,3} = {normal, forum-pinned, site-wide announcement,
 * category-pinned}. The user-facing requirement is that site-wide
 * announcements (sticky=2) appear at the very top of every forum's
 * list, including forums that contain a category-pinned thread
 * (sticky=3). We remap sticky=2 to rank 4 so it sorts above 3
 * without migrating the underlying column. ORDER BY and the keyset
 * cursor comparison MUST both use this expression — otherwise deep
 * pagination would skip rows. Cursor payloads also encode the
 * remapped rank (see `stickyRank`).
 */
const STICKY_RANK_EXPR = `CASE WHEN t.sticky = ${STICKY_GLOBAL} THEN 4 ELSE t.sticky END`;

/** JS-side mirror of STICKY_RANK_EXPR — used for cursor payload encoding. */
function stickyRank(sticky: number): number {
	return sticky === STICKY_GLOBAL ? 4 : sticky;
}

const THREAD_LIST_QUERY_CACHE: Readonly<
	Record<"kv" | "join", { withCursor: string; noCursor: string; offset: string }>
> = (() => {
	const build = (useKvCache: boolean, withCursor: boolean): string => {
		const selectFields = useKvCache
			? `t.*, ${IS_AUTHOR_FIRST_THREAD}`
			: `t.*, author.avatar AS author_avatar, author.avatar_path AS author_avatar_path, lp.avatar AS last_poster_avatar, lp.avatar_path AS last_poster_avatar_path, ${IS_AUTHOR_FIRST_THREAD}`;
		const fromClause = useKvCache
			? "threads t"
			: "threads t LEFT JOIN users author ON t.author_id = author.id LEFT JOIN users lp ON t.last_poster_id = lp.id";
		const whereClause = `(t.forum_id = ? OR t.sticky = ${STICKY_GLOBAL}) AND ${threadVisible("t")}`;
		const orderBy = `ORDER BY ${STICKY_RANK_EXPR} DESC, t.last_post_at DESC, t.id DESC`;
		if (withCursor) {
			const cursorCondition = `(${STICKY_RANK_EXPR} < ? OR (${STICKY_RANK_EXPR} = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))`;
			return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} AND ${cursorCondition} ${orderBy} LIMIT ?`;
		}
		return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} ${orderBy} LIMIT ?`;
	};
	const entry = (useKvCache: boolean) => {
		const noCursor = build(useKvCache, false);
		return {
			withCursor: build(useKvCache, true),
			noCursor,
			offset: `${noCursor} OFFSET ?`,
		};
	};
	return { kv: entry(true), join: entry(false) };
})();

/** Get thread list query based on cache strategy */
function getThreadListQuery(useKvCache: boolean, withCursor: boolean): string {
	const e = THREAD_LIST_QUERY_CACHE[useKvCache ? "kv" : "join"];
	return withCursor ? e.withCursor : e.noCursor;
}

/** Get thread list query with OFFSET for page-based pagination */
function getThreadListQueryWithOffset(useKvCache: boolean): string {
	return THREAD_LIST_QUERY_CACHE[useKvCache ? "kv" : "join"].offset;
}

// ─── typeId-filtered query variants ──────────────────────────────────
//
// When the caller passes `?typeId=N`, the list must be scoped to one
// (forumId, typeId) pair. Reviewer pin (msg 11e374e8): "filtered list
// 不带全站公告" — the global-announcement merge (sticky=STICKY_GLOBAL)
// is INTENTIONALLY DROPPED. Site-wide announcements are not bound to
// any thread type, so leaking them into a category-filtered view would
// re-introduce the same cross-type contamination the synthetic id
// migration set out to remove.
//
// `idx_threads_forum_type` (created in 0038/0039 path) makes the
// (forum_id, type_id) lookup an index seek; the ORDER BY tail is the
// same sticky-rank/last_post_at/id triple as the unfiltered query so
// the keyset cursor remains compatible.
const THREAD_LIST_TYPE_QUERY_CACHE: Readonly<
	Record<"kv" | "join", { withCursor: string; noCursor: string; offset: string }>
> = (() => {
	const build = (useKvCache: boolean, withCursor: boolean): string => {
		const selectFields = useKvCache
			? `t.*, ${IS_AUTHOR_FIRST_THREAD}`
			: `t.*, author.avatar AS author_avatar, author.avatar_path AS author_avatar_path, lp.avatar AS last_poster_avatar, lp.avatar_path AS last_poster_avatar_path, ${IS_AUTHOR_FIRST_THREAD}`;
		const fromClause = useKvCache
			? "threads t"
			: "threads t LEFT JOIN users author ON t.author_id = author.id LEFT JOIN users lp ON t.last_poster_id = lp.id";
		// Hard-bind both forum_id AND type_id; site-wide announcements are
		// NOT merged (see header comment).
		const whereClause = `t.forum_id = ? AND t.type_id = ? AND ${threadVisible("t")}`;
		const orderBy = `ORDER BY ${STICKY_RANK_EXPR} DESC, t.last_post_at DESC, t.id DESC`;
		if (withCursor) {
			const cursorCondition = `(${STICKY_RANK_EXPR} < ? OR (${STICKY_RANK_EXPR} = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))`;
			return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} AND ${cursorCondition} ${orderBy} LIMIT ?`;
		}
		return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} ${orderBy} LIMIT ?`;
	};
	const entry = (useKvCache: boolean) => {
		const noCursor = build(useKvCache, false);
		return {
			withCursor: build(useKvCache, true),
			noCursor,
			offset: `${noCursor} OFFSET ?`,
		};
	};
	return { kv: entry(true), join: entry(false) };
})();

function getThreadListTypeQuery(useKvCache: boolean, withCursor: boolean): string {
	const e = THREAD_LIST_TYPE_QUERY_CACHE[useKvCache ? "kv" : "join"];
	return withCursor ? e.withCursor : e.noCursor;
}

function getThreadListTypeQueryWithOffset(useKvCache: boolean): string {
	return THREAD_LIST_TYPE_QUERY_CACHE[useKvCache ? "kv" : "join"].offset;
}

/** GET /api/v1/threads - List threads with keyset or offset pagination */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	// Read query params directly from the raw URL (skip `new URL` + `URLSearchParams`).
	// Saves ~0.18 µs/request — see `lib/queryString.ts`.
	const rawUrl = request.url;
	const forumId = getQueryParam(rawUrl, "forumId");
	const cursorStr = getQueryParam(rawUrl, "cursor");
	const pageParam = getQueryParam(rawUrl, "page");
	const limitParam = getQueryParam(rawUrl, "limit");
	const typeIdParam = getQueryParam(rawUrl, "typeId");

	if (!forumId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "forumId is required" }, origin);
	}

	const forumIdNum = Number.parseInt(forumId, 10);
	if (Number.isNaN(forumIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forumId" }, origin);
	}

	// Pre-parse typeId. We can reject negative / non-integer input now;
	// the (forum_id, type_id) row check waits until after the visibility
	// gate so we don't betray "this typeId exists but you can't see the
	// forum" via timing.
	const typeIdInput = coerceTypeIdInput(typeIdParam);
	if (typeIdInput.kind === "invalid") {
		return errorResponse("INVALID_REQUEST", 400, { message: typeIdInput.message }, origin);
	}

	// Forum-visibility gate via `forum:meta:v2`. Happens BEFORE we look at
	// the thread-list cache so the cached payload itself can stay
	// bucket-independent (docs/19 §6 thread:list:v2). Auth + meta read run
	// in parallel because they're independent.
	const userPromise = optionalAuthVerified(request, env);
	const user = await userPromise;
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);
	const metaResult = await getForumMetaV2(env, ctx, forumIdNum, bucket, () =>
		loadFullForumFromD1(env, forumIdNum),
	);
	if (metaResult.kind === "notFound") {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (metaResult.kind === "forbidden") {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}

	// Clamp limit to [1, 100], defaulting to 100
	const clampedLimit = clampLimit(limitParam, {
		defaultLimit: 100,
		maxLimit: 100,
	});

	const useKvCache = isKvUserCacheEnabled(env);

	// typeId filter resolution. Has to happen AFTER the visibility gate
	// so we don't betray "this typeId exists but you can't see the
	// forum"; happens BEFORE caching/branching because the reviewer pin
	// (msg b03d4af3) requires typeId-filtered requests to bypass page1
	// KV — different cache key shape, different invalidation strategy,
	// not worth the complexity in the first cut.
	const typeResolution =
		typeIdInput.kind === "ok"
			? await resolveAndValidateTypeId(env, forumIdNum, typeIdInput.value, {
					enabled: metaResult.forum.threadTypes.enabled,
				})
			: ({ kind: "noTypeRequested" } as const);
	if (typeResolution.kind === "invalid") {
		return errorResponse("INVALID_REQUEST", 400, { message: typeResolution.message }, origin);
	}
	// Synthetic id for the SQL bind. `null` means "no filter" — original
	// global-merge behaviour applies.
	const typeIdFilter = typeResolution.kind === "ok" ? typeResolution.row.id : null;

	// page1 cache eligibility: cacheable limit bucket AND request shape is
	// page1 (no cursor, no page or page=1). Deeper pagination falls through
	// to D1. typeId-filtered requests bypass the page1 cache entirely.
	const page1 =
		typeIdFilter === null && isPage1(cursorStr, pageParam) && isCacheableLimit(clampedLimit);

	// Unified page1 loader. Both the keyset-no-cursor branch and the
	// offset-page=1 branch share the SAME thread:list:v2 cache key, so the
	// loader MUST emit the SAME payload regardless of which branch warmed
	// it. We compute total + nextCursor BOTH every time; the handler
	// branches at response shaping pick whichever is relevant.
	//
	// Cost: one extra COUNT(*) on cache miss for the keyset branch (which
	// previously skipped it). This is paid only on miss; subsequent reads
	// are KV hits.
	const loadPage1Payload = async (): Promise<ThreadListPayloadV2> => {
		const [countResult, dataResult] = await Promise.all([
			env.DB.prepare(
				`SELECT COUNT(*) as total FROM threads WHERE (forum_id = ? OR sticky = ${STICKY_GLOBAL}) AND ${THREAD_VISIBLE}`,
			)
				.bind(forumIdNum)
				.first<{ total: number }>(),
			env.DB.prepare(getThreadListQuery(useKvCache, false)).bind(forumIdNum, clampedLimit).all(),
		]);
		const total = countResult?.total ?? 0;
		// Cached payload is shared across all viewers (docs/19 §6 thread:list:v2
		// is bucket-independent), so we mask aggressively here — staff/self
		// readers will see masked authorId on the list and can click into the
		// thread detail to see the real author. Acceptable v1 trade-off; if
		// staff need masking-aware lists, the cache key needs a viewer
		// dimension.
		let items = mapThreadRows(dataResult.results, useKvCache, null);
		if (useKvCache) {
			items = await enrichThreadsWithUserCacheFromList(items, env, ctx);
		}
		// nextCursor is derived from RAW D1 rows (snake_case sticky /
		// last_post_at / id) so cursor encoding stays stable when the
		// mapped Thread shape evolves. `sticky` here is the SORT RANK
		// (see STICKY_RANK_EXPR) — sticky=2 is encoded as 4 so the
		// keyset comparator matches ORDER BY.
		const nextCursor = buildNextCursor<unknown, ThreadCursorPayload>(
			dataResult.results,
			clampedLimit,
			(last) => {
				const row = last as D1ThreadRow;
				return {
					sticky: stickyRank(row.sticky),
					lastPostAt: row.last_post_at,
					id: row.id,
				};
			},
		);
		return { items, total, nextCursor, limit: clampedLimit };
	};

	// -------------------------------------------------------------------
	// Branch: offset pagination (when ?page= is present and no ?cursor=)
	// -------------------------------------------------------------------
	if (pageParam && !cursorStr) {
		const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);

		const loadOffsetPayload = async (): Promise<ThreadListPayloadV2> => {
			const offset = (page - 1) * clampedLimit;
			const [countResult, dataResult] =
				typeIdFilter !== null
					? await Promise.all([
							// Filtered count: exact (forum_id, type_id) — no global
							// announcement merge, matches the SQL builder.
							env.DB.prepare(
								`SELECT COUNT(*) as total FROM threads WHERE forum_id = ? AND type_id = ? AND ${THREAD_VISIBLE}`,
							)
								.bind(forumIdNum, typeIdFilter)
								.first<{ total: number }>(),
							env.DB.prepare(getThreadListTypeQueryWithOffset(useKvCache))
								.bind(forumIdNum, typeIdFilter, clampedLimit, offset)
								.all(),
						])
					: await Promise.all([
							env.DB.prepare(
								`SELECT COUNT(*) as total FROM threads WHERE (forum_id = ? OR sticky = ${STICKY_GLOBAL}) AND ${THREAD_VISIBLE}`,
							)
								.bind(forumIdNum)
								.first<{ total: number }>(),
							env.DB.prepare(getThreadListQueryWithOffset(useKvCache))
								.bind(forumIdNum, clampedLimit, offset)
								.all(),
						]);
			const total = countResult?.total ?? 0;
			let items = mapThreadRows(dataResult.results, useKvCache, null);
			if (useKvCache) {
				items = await enrichThreadsWithUserCacheFromList(items, env, ctx);
			}
			return { items, total, nextCursor: null, limit: clampedLimit };
		};

		const payload =
			page1 && page === 1
				? await getThreadListPageOneV2(
						env,
						ctx,
						forumIdNum,
						clampedLimit as 20 | 50 | 100,
						loadPage1Payload,
					)
				: await loadOffsetPayload();

		return paginatedResponse(payload.items, payload.total, page, payload.limit, origin);
	}

	// -------------------------------------------------------------------
	// Branch: keyset cursor pagination (default / backward-compatible)
	// -------------------------------------------------------------------
	const cursor = cursorStr
		? decodeGenericCursor<ThreadCursorPayload>(cursorStr, isThreadCursor)
		: null;

	const loadKeysetPayload = async (): Promise<ThreadListPayloadV2> => {
		const result: D1Result =
			typeIdFilter !== null
				? cursor
					? await env.DB.prepare(getThreadListTypeQuery(useKvCache, true))
							.bind(
								forumIdNum,
								typeIdFilter,
								cursor.sticky,
								cursor.sticky,
								cursor.lastPostAt,
								cursor.lastPostAt,
								cursor.id,
								clampedLimit,
							)
							.all()
					: await env.DB.prepare(getThreadListTypeQuery(useKvCache, false))
							.bind(forumIdNum, typeIdFilter, clampedLimit)
							.all()
				: cursor
					? await env.DB.prepare(getThreadListQuery(useKvCache, true))
							.bind(
								forumIdNum,
								cursor.sticky,
								cursor.sticky,
								cursor.lastPostAt,
								cursor.lastPostAt,
								cursor.id,
								clampedLimit,
							)
							.all()
					: await env.DB.prepare(getThreadListQuery(useKvCache, false))
							.bind(forumIdNum, clampedLimit)
							.all();

		let items = mapThreadRows(result.results, useKvCache, null);
		if (useKvCache) {
			items = await enrichThreadsWithUserCacheFromList(items, env, ctx);
		}
		// nextCursor MUST be derived from the raw D1 row (snake_case sticky/
		// last_post_at/id), NOT the mapped Thread — keeps cursor encoding
		// stable when the Thread shape evolves. `sticky` here is the SORT
		// RANK (see STICKY_RANK_EXPR) — sticky=2 is encoded as 4 so the
		// keyset comparator matches ORDER BY.
		const nextCursor = buildNextCursor<unknown, ThreadCursorPayload>(
			result.results,
			clampedLimit,
			(last) => {
				const row = last as D1ThreadRow;
				return {
					sticky: stickyRank(row.sticky),
					lastPostAt: row.last_post_at,
					id: row.id,
				};
			},
		);
		// Deep-keyset loader: only used when a cursor is present, never
		// passed to the page1 cache. `total` is irrelevant on this path
		// (the keyset response shape doesn't expose it), so we return 0
		// to satisfy the tightened `ThreadListPayloadV2.total: number`
		// contract without paying for a COUNT round-trip.
		return { items, total: 0, nextCursor, limit: clampedLimit };
	};

	const payload = page1
		? await getThreadListPageOneV2(
				env,
				ctx,
				forumIdNum,
				clampedLimit as 20 | 50 | 100,
				loadPage1Payload,
			)
		: await loadKeysetPayload();

	return jsonListResponse(payload.items, origin, payload.nextCursor);
}

/** Helper to enrich threads with user cache (only used when KV cache is enabled) */
async function enrichThreadsWithUserCacheFromList(
	threads: Thread[],
	env: Env,
	ctx: ExecutionContext,
): Promise<Thread[]> {
	// Collect all user IDs (authors and last posters)
	const userIds = new Set<number>();
	for (const thread of threads) {
		if (thread.authorId > 0) userIds.add(thread.authorId);
		if (thread.lastPosterId > 0) userIds.add(thread.lastPosterId);
	}
	if (userIds.size === 0) return threads;

	const userCache = await getUserProfiles(env, ctx, [...userIds]);
	return enrichThreadsWithUserCache(threads, userCache);
}

/** GET /api/v1/threads/:id - Get thread by ID (and increment view count) */
export async function getById(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const useKvCache = isKvUserCacheEnabled(env);

	// Choose query based on cache strategy (include forum_id for visibility check)
	// Return visible threads (sticky >= 0) plus moderated threads (sticky = -2)
	// for post-fetch authorization against the requesting user.
	const threadFilter = `(${threadVisible("t")} OR t.sticky = ${STICKY_MODERATED})`;
	//
	// `is_recommended` is a one-row EXISTS probe on the
	// `forum_recommended_threads` composite PK (migration 0045). The
	// thread-detail mod menu reads it to render the "推荐 / 已推荐"
	// toggle without a second round-trip. The probe is bound to the
	// thread row's own forum_id so a stale row in another forum (from a
	// past move-without-cleanup bug) cannot lie about the current state.
	const threadQuery = useKvCache
		? `SELECT t.*,
		          EXISTS(SELECT 1 FROM forum_recommended_threads r
		                  WHERE r.forum_id = t.forum_id AND r.thread_id = t.id) AS is_recommended
		     FROM threads t WHERE t.id = ? AND ${threadFilter}`
		: `SELECT t.*,
		          author.avatar AS author_avatar,
		          author.avatar_path AS author_avatar_path,
		          lp.avatar AS last_poster_avatar,
		          lp.avatar_path AS last_poster_avatar_path,
		          EXISTS(SELECT 1 FROM forum_recommended_threads r
		                  WHERE r.forum_id = t.forum_id AND r.thread_id = t.id) AS is_recommended
		   FROM threads t
		   LEFT JOIN users author ON t.author_id = author.id
		   LEFT JOIN users lp ON t.last_poster_id = lp.id
		   WHERE t.id = ? AND ${threadFilter}`;

	// Auth is independent of the thread row — fire it eagerly so it overlaps
	// with both the thread query and (later) the forum visibility query.
	const userPromise = optionalAuthVerified(request, env);

	const result = await env.DB.prepare(threadQuery).bind(id).first();

	if (!result) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const r = result as Record<string, unknown>;
	const forumId = r.forum_id as number;

	// Forum query and auth resolution can also overlap.
	const [user, forumRow] = await Promise.all([
		userPromise,
		env.DB.prepare("SELECT status, visibility, moderator_ids FROM forums WHERE id = ?")
			.bind(forumId)
			.first<{ status: number; visibility: string; moderator_ids: string }>(),
	]);
	const visCtx = buildVisibilityContext(user);

	if (!isForumActive(forumRow)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const sticky = r.sticky as number;

	// Moderated threads: only author / forum mod / super-mod / admin may view.
	// Return 404 (not 403) so existence is not leaked.
	if (sticky === STICKY_MODERATED) {
		if (
			!canViewModeratedThread({
				authorId: r.author_id as number,
				forumModeratorIds: forumRow.moderator_ids ?? "",
				user,
			})
		) {
			return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
		}
	} else if (
		!canReadThreadContent({
			sticky,
			forumVisibility: forumRow.visibility as ForumVisibility,
			visCtx,
		})
	) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this thread" },
			origin,
		);
	}

	// Schedule the view-count bump under ctx.waitUntil so the UPDATE
	// stays bound to the Worker lifecycle. The previous fire-and-forget
	// `void DB.run()` could be cancelled when the response returned,
	// causing low-traffic threads to stay pinned at views=0.
	// Skip for moderated threads — internal viewers shouldn't inflate counts.
	if (sticky !== STICKY_MODERATED) {
		scheduleThreadViewIncrement(env, ctx, id);
	}

	let thread = toThread(r, toViewer(user));

	if (sticky === STICKY_MODERATED) {
		thread.moderationStatus = "pending_review";
	}

	thread = await enrichThreadDetailAvatars(env, ctx, thread, r, useKvCache);

	return jsonResponse(thread, origin);
}

/** Resolve author/last-poster avatars on a single Thread, respecting the
 * anonymous masking already applied by {@link toThread}. Pulled out so
 * `getById` stays under the cognitive-complexity ceiling. */
async function enrichThreadDetailAvatars(
	env: Env,
	ctx: ExecutionContext,
	thread: Thread,
	row: Record<string, unknown>,
	useKvCache: boolean,
): Promise<Thread> {
	// JOIN approach: avatars come on the row itself. Anonymous threads have
	// authorId/lastPosterId zeroed by toThread(), so don't surface the
	// underlying user's avatar in those slots.
	if (!useKvCache) {
		if (thread.authorId !== 0) {
			thread.authorAvatar = (row.author_avatar as string) ?? "";
			thread.authorAvatarPath = (row.author_avatar_path as string) ?? "";
		}
		if (thread.lastPosterId !== 0) {
			thread.lastPosterAvatar = (row.last_poster_avatar as string) ?? "";
			thread.lastPosterAvatarPath = (row.last_poster_avatar_path as string) ?? "";
		}
		return thread;
	}

	// KV-cache approach: only non-zero (unmasked) ids reach getUserProfiles.
	const userIds = [thread.authorId, thread.lastPosterId].filter((uid) => uid > 0);
	if (userIds.length === 0) return thread;
	const userCache = await getUserProfiles(env, ctx, userIds);
	return enrichThreadsWithUserCache([thread], userCache)[0] ?? thread;
}

/** POST /api/v1/threads - Create a new thread (requires auth) */
export const create = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Check posting permission (banned, muted, registration days, avatar, content switch)
	const permissionResult = await checkPostingPermission(env, user, origin, "thread");
	if (!permissionResult.allowed) {
		return permissionResult.error;
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const forumId = typeof body.forumId === "number" ? body.forumId : undefined;
	const subject = typeof body.subject === "string" ? body.subject : undefined;
	let content = typeof body.content === "string" ? body.content : undefined;

	if (typeof forumId !== "number" || Number.isNaN(forumId)) {
		return errorResponse("INVALID_BODY", 400, { message: "forumId is required (number)" }, origin);
	}
	if (!subject || subject.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "subject is required" }, origin);
	}
	if (subject.length > 200) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "subject must be at most 200 characters" },
			origin,
		);
	}
	if (!content || content.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "content is required" }, origin);
	}

	// Pre-parse `typeId` BEFORE censor / DB hits — a malformed typeId is a
	// caller bug we can reject without spending any further resources.
	// `coerceTypeIdInput` short-circuits null/undefined/"" to "absent" so
	// older clients that omit typeId remain unaffected.
	const typeIdParse = coerceTypeIdInput(body.typeId);
	if (typeIdParse.kind === "invalid") {
		return errorResponse("INVALID_BODY", 400, { message: typeIdParse.message }, origin);
	}
	const typeIdInput = typeIdParse.kind === "ok" ? typeIdParse.value : null;

	// Censor word check — subject + content (independent, run in parallel)
	const [subjectCheck, contentCheck] = await Promise.all([
		applyCensorFilter(subject.trim(), env),
		applyCensorFilter(content.trim(), env),
	]);
	if (subjectCheck.banned || contentCheck.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	const filteredSubject = subjectCheck.content;
	content = contentCheck.content;

	// Forum visibility query + author-name lookup are independent of each
	// other and of the censor checks above — fire both in parallel.
	// SELECT widened with `thread_types_enabled` / `thread_types_required`
	// so we can validate `body.typeId` without an extra D1 hit (the create
	// path doesn't go through the cached forum:meta:v2 reader).
	const [forum, authorRow] = await Promise.all([
		env.DB.prepare(
			"SELECT id, status, visibility, thread_types_enabled, thread_types_required FROM forums WHERE id = ?",
		)
			.bind(forumId)
			.first<{
				id: number;
				status: number;
				visibility: string;
				thread_types_enabled: number;
				thread_types_required: number;
			}>(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
	]);

	if (!isForumActive(forum)) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	// Check if user can post to this forum (visibility check)
	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	if (!canViewForumVisibility(forum.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to post in this forum" },
			origin,
		);
	}

	// Resolve typeId against the forum gate. Reuses the same
	// `resolveAndValidateTypeId` helper as the GET filter (msg b4221d27)
	// so that "disabled forum / cross-forum / tombstoned row / not in this
	// forum" all surface identical 4xx semantics.
	//
	// `forum.thread_types_required = 1` adds one extra rule on top of the
	// resolver: a missing typeId is a 400 (forum requires picking a
	// category before posting). The resolver itself doesn't enforce
	// "required" because the list-filter path treats absent typeId as
	// "no filter" — we only check it here on create.
	const typeResolution = await resolveAndValidateTypeId(env, forumId, typeIdInput, {
		enabled: forum.thread_types_enabled === 1,
	});
	if (typeResolution.kind === "invalid") {
		return errorResponse("INVALID_BODY", 400, { message: typeResolution.message }, origin);
	}
	if (
		typeResolution.kind === "noTypeRequested" &&
		forum.thread_types_enabled === 1 &&
		forum.thread_types_required === 1
	) {
		return errorResponse("INVALID_BODY", 400, { message: "Forum requires a thread type" }, origin);
	}
	// Reviewer pin (msg 4f1464c8): denorm columns must be `0 / ""` when no
	// type is selected — never NULL. The synthetic id stays the same as
	// the value we wrote on import.
	const insertTypeId = typeResolution.kind === "ok" ? typeResolution.row.id : 0;
	const insertTypeName = typeResolution.kind === "ok" ? typeResolution.row.name : "";

	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Step 1: Insert thread (with last_poster_id for user cache)
	const threadResult = await env.DB.prepare(
		"INSERT INTO threads (forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, last_poster_id, replies, views, closed, sticky, digest, type_id, type_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, ?, ?)",
	)
		.bind(
			forumId,
			user.userId,
			authorName,
			filteredSubject,
			now,
			now,
			authorName,
			user.userId,
			insertTypeId,
			insertTypeName,
		)
		.run();

	const threadId = threadResult.meta.last_row_id;

	// Step 2: batch the post insert + count updates, while concurrently
	// fetching the just-inserted thread row. The thread row was already
	// committed by Step 1, so the SELECT can run alongside the batch —
	// shaving one D1 round-trip off the create-thread response time.
	const [, createdThread] = await Promise.all([
		env.DB.batch([
			env.DB.prepare(
				"INSERT INTO posts (thread_id, forum_id, author_id, author_name, content, created_at, is_first, position) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
			).bind(threadId, forumId, user.userId, authorName, content, now),
			env.DB.prepare(
				"UPDATE forums SET threads = threads + 1, posts = posts + 1, last_thread_id = ?, last_post_at = ?, last_poster = ?, last_poster_id = ?, last_thread_subject = ? WHERE id = ?",
			).bind(threadId, now, authorName, user.userId, filteredSubject, forumId),
			env.DB.prepare("UPDATE users SET threads = threads + 1, posts = posts + 1 WHERE id = ?").bind(
				user.userId,
			),
		]),
		env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(threadId).first(),
	]);

	// Cache invalidation (docs/19 §6 row "POST /api/v1/threads"):
	// Bump `forum:summary:gen` + `thread:list:gen:<forumId>` so future v2
	// caches see a fresh gen.
	await Promise.all([
		invalidateForumVolatileV2(env, forumId),
		// Increment pre-computed stats counters (fire-and-forget on error)
		incrementStatsOnThreadCreate(env).catch((e) =>
			console.warn("[thread:create] stats counter increment failed", e),
		),
	]);

	return jsonResponse(
		toThread(createdThread as Record<string, unknown>, {
			userId: user.userId,
			role: user.role,
		}),
		origin,
		undefined,
		201,
	);
});
