// Thread handlers for Cloudflare Worker
import { type Thread, canViewForumVisibility, decodeGenericCursor } from "@ellie/types";
import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import { getForumMetaV2 } from "../lib/cache/forum-read";
import { invalidateForumVolatileV2 } from "../lib/cache/invalidate";
import {
	type ThreadListPayloadV2,
	getThreadListPageOneV2,
	isCacheableLimit,
	isPage1,
} from "../lib/cache/thread-list-read";
import { applyCensorFilter } from "../lib/censor";
import { type Env, isKvUserCacheEnabled } from "../lib/env";
import { enrichThreadsWithUserCache, toThread } from "../lib/mappers";
import { buildNextCursor, clampLimit } from "../lib/pagination";
import { checkPostingPermission } from "../lib/postingPermission";
import { getQueryParam } from "../lib/queryString";
import { jsonListResponse, jsonResponse, paginatedResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { getUserProfiles } from "../lib/user-cache";
import {
	THREAD_VISIBLE,
	buildVisibilityContext,
	isForumActive,
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

/** Map D1 rows to Thread objects with optional avatar enrichment */
function mapThreadRows(results: unknown[], useKvCache: boolean): Thread[] {
	// Inline toThread + avatar fan-out into one allocation per row — avoids
	// a function call and a 4-field post-creation mutation when JOIN data is
	// present. Property order matches toThread() so V8 can keep a single
	// hidden class for both call sites.
	const n = results.length;
	const out = new Array<Thread>(n);
	if (useKvCache) {
		for (let i = 0; i < n; i++) {
			const r = results[i] as unknown as D1ThreadRowLike;
			out[i] = {
				id: r.id,
				forumId: r.forum_id,
				authorId: r.author_id,
				authorName: r.author_name,
				authorAvatar: "",
				authorAvatarPath: "",
				subject: r.subject,
				createdAt: r.created_at,
				lastPostAt: r.last_post_at,
				lastPoster: r.last_poster,
				lastPosterId: r.last_poster_id ?? 0,
				lastPosterAvatar: "",
				lastPosterAvatarPath: "",
				replies: r.replies,
				views: r.views,
				closed: r.closed,
				sticky: r.sticky,
				digest: r.digest,
				special: r.special,
				highlight: r.highlight,
				recommends: r.recommends,
				typeName: r.type_name,
			};
		}
	} else {
		for (let i = 0; i < n; i++) {
			const r = results[i] as unknown as D1ThreadRowLike;
			out[i] = {
				id: r.id,
				forumId: r.forum_id,
				authorId: r.author_id,
				authorName: r.author_name,
				authorAvatar: (r.author_avatar as string | undefined) ?? "",
				authorAvatarPath: (r.author_avatar_path as string | undefined) ?? "",
				subject: r.subject,
				createdAt: r.created_at,
				lastPostAt: r.last_post_at,
				lastPoster: r.last_poster,
				lastPosterId: r.last_poster_id ?? 0,
				lastPosterAvatar: (r.last_poster_avatar as string | undefined) ?? "",
				lastPosterAvatarPath: (r.last_poster_avatar_path as string | undefined) ?? "",
				replies: r.replies,
				views: r.views,
				closed: r.closed,
				sticky: r.sticky,
				digest: r.digest,
				special: r.special,
				highlight: r.highlight,
				recommends: r.recommends,
				typeName: r.type_name,
			};
		}
	}
	return out;
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
	author_avatar?: string;
	author_avatar_path?: string;
	last_poster_avatar?: string;
	last_poster_avatar_path?: string;
}

/** Get thread list query based on cache strategy */
// Pre-compute the four SQL templates produced by getThreadListQuery so we
// don't rebuild them on every request. The shape only depends on two booleans
// (useKvCache, withCursor) so a 2x2 lookup is enough.
const THREAD_LIST_QUERY_CACHE: Readonly<
	Record<"kv" | "join", { withCursor: string; noCursor: string; offset: string }>
> = (() => {
	const build = (useKvCache: boolean, withCursor: boolean): string => {
		const selectFields = useKvCache
			? "*"
			: "t.*, author.avatar AS author_avatar, author.avatar_path AS author_avatar_path, lp.avatar AS last_poster_avatar, lp.avatar_path AS last_poster_avatar_path";
		const fromClause = useKvCache
			? "threads"
			: "threads t LEFT JOIN users author ON t.author_id = author.id LEFT JOIN users lp ON t.last_poster_id = lp.id";
		const tablePrefix = useKvCache ? "" : "t.";
		const whereClause = useKvCache
			? `forum_id = ? AND ${THREAD_VISIBLE}`
			: `t.forum_id = ? AND ${threadVisible("t")}`;
		if (withCursor) {
			const cursorCondition = `(${tablePrefix}sticky < ? OR (${tablePrefix}sticky = ? AND (${tablePrefix}last_post_at < ? OR (${tablePrefix}last_post_at = ? AND ${tablePrefix}id < ?))))`;
			return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} AND ${cursorCondition} ORDER BY ${tablePrefix}sticky DESC, ${tablePrefix}last_post_at DESC, ${tablePrefix}id DESC LIMIT ?`;
		}
		return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} ORDER BY ${tablePrefix}sticky DESC, ${tablePrefix}last_post_at DESC, ${tablePrefix}id DESC LIMIT ?`;
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

	if (!forumId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "forumId is required" }, origin);
	}

	const forumIdNum = Number.parseInt(forumId, 10);
	if (Number.isNaN(forumIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forumId" }, origin);
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

	// page1 cache eligibility: cacheable limit bucket AND request shape is
	// page1 (no cursor, no page or page=1). Deeper pagination falls through
	// to D1.
	const page1 = isPage1(cursorStr, pageParam) && isCacheableLimit(clampedLimit);

	// -------------------------------------------------------------------
	// Branch: offset pagination (when ?page= is present and no ?cursor=)
	// -------------------------------------------------------------------
	if (pageParam && !cursorStr) {
		const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);

		const loadOffsetPayload = async (): Promise<ThreadListPayloadV2> => {
			const offset = (page - 1) * clampedLimit;
			const [countResult, dataResult] = await Promise.all([
				env.DB.prepare(
					`SELECT COUNT(*) as total FROM threads WHERE forum_id = ? AND ${THREAD_VISIBLE}`,
				)
					.bind(forumIdNum)
					.first<{ total: number }>(),
				env.DB.prepare(getThreadListQueryWithOffset(useKvCache))
					.bind(forumIdNum, clampedLimit, offset)
					.all(),
			]);
			const total = countResult?.total ?? 0;
			let items = mapThreadRows(dataResult.results, useKvCache);
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
						loadOffsetPayload,
					)
				: await loadOffsetPayload();

		return paginatedResponse(payload.items, payload.total ?? 0, page, payload.limit, origin);
	}

	// -------------------------------------------------------------------
	// Branch: keyset cursor pagination (default / backward-compatible)
	// -------------------------------------------------------------------
	const cursor = cursorStr
		? decodeGenericCursor<ThreadCursorPayload>(cursorStr, isThreadCursor)
		: null;

	const loadKeysetPayload = async (): Promise<ThreadListPayloadV2> => {
		const query = getThreadListQuery(useKvCache, cursor !== null);
		const result: D1Result = cursor
			? await env.DB.prepare(query)
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
			: await env.DB.prepare(query).bind(forumIdNum, clampedLimit).all();

		let items = mapThreadRows(result.results, useKvCache);
		if (useKvCache) {
			items = await enrichThreadsWithUserCacheFromList(items, env, ctx);
		}
		// nextCursor MUST be derived from the raw D1 row (snake_case sticky/
		// last_post_at/id), NOT the mapped Thread — keeps cursor encoding
		// stable when the Thread shape evolves.
		const nextCursor = buildNextCursor<unknown, ThreadCursorPayload>(
			result.results,
			clampedLimit,
			(last) => {
				const row = last as D1ThreadRow;
				return {
					sticky: row.sticky,
					lastPostAt: row.last_post_at,
					id: row.id,
				};
			},
		);
		return { items, total: null, nextCursor, limit: clampedLimit };
	};

	const payload = page1
		? await getThreadListPageOneV2(
				env,
				ctx,
				forumIdNum,
				clampedLimit as 20 | 50 | 100,
				loadKeysetPayload,
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
	// Only return visible threads (sticky >= 0)
	const threadQuery = useKvCache
		? `SELECT * FROM threads WHERE id = ? AND ${THREAD_VISIBLE}`
		: `SELECT t.*,
		          author.avatar AS author_avatar,
		          author.avatar_path AS author_avatar_path,
		          lp.avatar AS last_poster_avatar,
		          lp.avatar_path AS last_poster_avatar_path
		   FROM threads t
		   LEFT JOIN users author ON t.author_id = author.id
		   LEFT JOIN users lp ON t.last_poster_id = lp.id
		   WHERE t.id = ? AND ${threadVisible("t")}`;

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
		env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
			.bind(forumId)
			.first<{ status: number; visibility: string }>(),
	]);
	const visCtx = buildVisibilityContext(user);

	if (!isForumActive(forumRow)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}
	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this thread" },
			origin,
		);
	}

	// Fire-and-forget: increment view count (don't await)
	void env.DB.prepare("UPDATE threads SET views = views + 1 WHERE id = ?").bind(id).run();

	let thread = toThread(r);

	// If JOIN approach, populate avatars directly from query result
	if (!useKvCache) {
		thread.authorAvatar = (r.author_avatar as string) ?? "";
		thread.authorAvatarPath = (r.author_avatar_path as string) ?? "";
		thread.lastPosterAvatar = (r.last_poster_avatar as string) ?? "";
		thread.lastPosterAvatarPath = (r.last_poster_avatar_path as string) ?? "";
	}

	// Enrich with KV user cache (only if enabled)
	if (useKvCache) {
		const userIds = [thread.authorId, thread.lastPosterId].filter((uid) => uid > 0);
		if (userIds.length > 0) {
			const userCache = await getUserProfiles(env, ctx, userIds);
			thread = enrichThreadsWithUserCache([thread], userCache)[0] ?? thread;
		}
	}

	return jsonResponse(thread, origin);
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
	const [forum, authorRow] = await Promise.all([
		env.DB.prepare("SELECT id, status, visibility FROM forums WHERE id = ?")
			.bind(forumId)
			.first<{ id: number; status: number; visibility: string }>(),
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

	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Step 1: Insert thread (with last_poster_id for user cache)
	const threadResult = await env.DB.prepare(
		"INSERT INTO threads (forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, last_poster_id, replies, views, closed, sticky, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)",
	)
		.bind(forumId, user.userId, authorName, filteredSubject, now, now, authorName, user.userId)
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
	await invalidateForumVolatileV2(env, forumId);

	return jsonResponse(toThread(createdThread as Record<string, unknown>), origin, undefined, 201);
});
