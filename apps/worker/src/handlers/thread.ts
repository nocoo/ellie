// Thread handlers for Cloudflare Worker
import type { Thread } from "@ellie/types";
import { applyCensorFilter } from "../lib/censor";
import { type Env, isKvUserCacheEnabled } from "../lib/env";
import { enrichThreadWithUserCache, enrichThreadsWithUserCache, toThread } from "../lib/mappers";
import { jsonResponse, paginatedResponse } from "../lib/response";
import { withAuth } from "../lib/routeHelpers";
import { getUserProfiles } from "../lib/user-cache";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Thread cursor payload for keyset pagination */
interface ThreadCursorPayload {
	sticky: number;
	lastPostAt: number;
	id: number;
}

/** Encode thread cursor to base64 */
function encodeThreadCursor(payload: ThreadCursorPayload): string {
	return btoa(JSON.stringify(payload));
}

/** Decode thread cursor from base64 */
function decodeThreadCursor(cursor: string): ThreadCursorPayload | null {
	try {
		const json = atob(cursor);
		const parsed = JSON.parse(json) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"sticky" in parsed &&
			"lastPostAt" in parsed &&
			"id" in parsed &&
			typeof (parsed as ThreadCursorPayload).sticky === "number" &&
			typeof (parsed as ThreadCursorPayload).lastPostAt === "number" &&
			typeof (parsed as ThreadCursorPayload).id === "number"
		) {
			return parsed as ThreadCursorPayload;
		}
		return null;
	} catch {
		return null;
	}
}

/** D1 row shape for cursor extraction (snake_case) */
interface D1ThreadRow {
	id: number;
	sticky: number;
	last_post_at: number;
}

/** Map D1 rows to Thread objects with optional avatar enrichment */
function mapThreadRows(results: unknown[], useKvCache: boolean): Thread[] {
	return results.map((row) => {
		const r = row as Record<string, unknown>;
		const thread = toThread(r);
		// If JOIN approach, populate avatars directly from query result
		if (!useKvCache) {
			thread.authorAvatar = (r.author_avatar as string) ?? "";
			thread.lastPosterAvatar = (r.last_poster_avatar as string) ?? "";
		}
		return thread;
	});
}

/** Get thread list query based on cache strategy */
function getThreadListQuery(useKvCache: boolean, withCursor: boolean): string {
	const selectFields = useKvCache
		? "*"
		: "t.*, author.avatar AS author_avatar, lp.avatar AS last_poster_avatar";
	const fromClause = useKvCache
		? "threads"
		: "threads t LEFT JOIN users author ON t.author_id = author.id LEFT JOIN users lp ON t.last_poster_id = lp.id";
	const tablePrefix = useKvCache ? "" : "t.";
	const whereClause = useKvCache ? "forum_id = ?" : "t.forum_id = ?";

	if (withCursor) {
		const cursorCondition = `(${tablePrefix}sticky < ? OR (${tablePrefix}sticky = ? AND (${tablePrefix}last_post_at < ? OR (${tablePrefix}last_post_at = ? AND ${tablePrefix}id < ?))))`;
		return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} AND ${cursorCondition} ORDER BY ${tablePrefix}sticky DESC, ${tablePrefix}last_post_at DESC, ${tablePrefix}id DESC LIMIT ?`;
	}
	return `SELECT ${selectFields} FROM ${fromClause} WHERE ${whereClause} ORDER BY ${tablePrefix}sticky DESC, ${tablePrefix}last_post_at DESC, ${tablePrefix}id DESC LIMIT ?`;
}

/** Get thread list query with OFFSET for page-based pagination */
function getThreadListQueryWithOffset(useKvCache: boolean): string {
	// Base query ends with "LIMIT ?", append " OFFSET ?" to get "LIMIT ? OFFSET ?"
	return `${getThreadListQuery(useKvCache, false)} OFFSET ?`;
}

/** GET /api/v1/threads - List threads with keyset or offset pagination */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const forumId = url.searchParams.get("forumId");
	const limitParam = url.searchParams.get("limit");
	const cursorStr = url.searchParams.get("cursor");
	const pageParam = url.searchParams.get("page");

	if (!forumId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "forumId is required" }, origin);
	}

	const forumIdNum = Number.parseInt(forumId, 10);
	if (Number.isNaN(forumIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forumId" }, origin);
	}

	// Clamp limit to [1, 100], defaulting to 100
	const DEFAULT_PAGE_SIZE = 100;
	const MAX_PAGE_SIZE = 100;
	const limitNum = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	const clampedLimit =
		limitNum === undefined || limitNum <= 0 ? DEFAULT_PAGE_SIZE : Math.min(limitNum, MAX_PAGE_SIZE);

	const useKvCache = isKvUserCacheEnabled(env);

	// -------------------------------------------------------------------
	// Branch: offset pagination (when ?page= is present and no ?cursor=)
	// -------------------------------------------------------------------
	if (pageParam && !cursorStr) {
		const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);
		const offset = (page - 1) * clampedLimit;

		const [countResult, dataResult] = await Promise.all([
			env.DB.prepare("SELECT COUNT(*) as total FROM threads WHERE forum_id = ?")
				.bind(forumIdNum)
				.first<{ total: number }>(),
			env.DB.prepare(getThreadListQueryWithOffset(useKvCache))
				.bind(forumIdNum, clampedLimit, offset)
				.all(),
		]);

		const total = countResult?.total ?? 0;
		let threads = mapThreadRows(dataResult.results, useKvCache);

		// Enrich with KV user cache (only if enabled)
		if (useKvCache) {
			threads = await enrichThreadsWithUserCacheFromList(threads, env, ctx);
		}

		return paginatedResponse(threads, total, page, clampedLimit, origin);
	}

	// -------------------------------------------------------------------
	// Branch: keyset cursor pagination (default / backward-compatible)
	// -------------------------------------------------------------------
	const cursor = cursorStr ? decodeThreadCursor(cursorStr) : null;
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

	// Map D1 snake_case rows to camelCase Thread type
	let threads = mapThreadRows(result.results, useKvCache);

	// Enrich with KV user cache (only if enabled)
	if (useKvCache) {
		threads = await enrichThreadsWithUserCacheFromList(threads, env, ctx);
	}

	// Generate next cursor from raw D1 row (snake_case) — NOT from mapped Thread
	let nextCursor: string | null = null;
	if (threads.length === clampedLimit && threads.length > 0) {
		const lastRawRow = result.results[result.results.length - 1] as unknown as D1ThreadRow;
		if (lastRawRow) {
			nextCursor = encodeThreadCursor({
				sticky: lastRawRow.sticky,
				lastPostAt: lastRawRow.last_post_at,
				id: lastRawRow.id,
			});
		}
	}

	return new Response(
		JSON.stringify({
			data: threads,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
				nextCursor,
			},
		}),
		{
			headers: {
				...corsHeaders(origin),
				"Content-Type": "application/json",
			},
		},
	);
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

	// Choose query based on cache strategy
	const threadQuery = useKvCache
		? "SELECT * FROM threads WHERE id = ?"
		: `SELECT t.*,
		          author.avatar AS author_avatar,
		          lp.avatar AS last_poster_avatar
		   FROM threads t
		   LEFT JOIN users author ON t.author_id = author.id
		   LEFT JOIN users lp ON t.last_poster_id = lp.id
		   WHERE t.id = ?`;

	const result = await env.DB.prepare(threadQuery).bind(id).first();

	if (!result) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// Fire-and-forget: increment view count (don't await)
	void env.DB.prepare("UPDATE threads SET views = views + 1 WHERE id = ?").bind(id).run();

	const r = result as Record<string, unknown>;
	let thread = toThread(r);

	// If JOIN approach, populate avatars directly from query result
	if (!useKvCache) {
		thread.authorAvatar = (r.author_avatar as string) ?? "";
		thread.lastPosterAvatar = (r.last_poster_avatar as string) ?? "";
	}

	// Enrich with KV user cache (only if enabled)
	if (useKvCache) {
		const userIds = [thread.authorId, thread.lastPosterId].filter((uid) => uid > 0);
		if (userIds.length > 0) {
			const userCache = await getUserProfiles(env, ctx, userIds);
			thread = enrichThreadWithUserCache(thread, userCache);
		}
	}

	return new Response(
		JSON.stringify({
			data: thread,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
			},
		}),
		{
			headers: {
				...corsHeaders(origin),
				"Content-Type": "application/json",
			},
		},
	);
}

/** POST /api/v1/threads - Create a new thread (requires auth) */
export const create = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

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

	// Censor word check — subject + content
	const subjectCheck = await applyCensorFilter(subject.trim(), env);
	if (subjectCheck.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	const contentCheck = await applyCensorFilter(content.trim(), env);
	if (contentCheck.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	const filteredSubject = subjectCheck.content;
	content = contentCheck.content;

	// Validate forum exists
	const forum = await env.DB.prepare("SELECT id FROM forums WHERE id = ?").bind(forumId).first();
	if (!forum) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	// Fetch author name from users table
	const authorRow = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ username: string }>();
	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Step 1: Insert thread (with last_poster_id for user cache)
	const threadResult = await env.DB.prepare(
		"INSERT INTO threads (forum_id, author_id, author_name, subject, created_at, last_post_at, last_poster, last_poster_id, replies, views, closed, sticky, digest) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)",
	)
		.bind(forumId, user.userId, authorName, filteredSubject, now, now, authorName, user.userId)
		.run();

	const threadId = threadResult.meta.last_row_id;

	// Step 2: Batch insert first post + update counts (with last_poster_id)
	await env.DB.batch([
		env.DB.prepare(
			"INSERT INTO posts (thread_id, forum_id, author_id, author_name, content, created_at, is_first, position) VALUES (?, ?, ?, ?, ?, ?, 1, 1)",
		).bind(threadId, forumId, user.userId, authorName, content, now),
		env.DB.prepare(
			"UPDATE forums SET threads = threads + 1, posts = posts + 1, last_thread_id = ?, last_post_at = ?, last_poster = ?, last_poster_id = ?, last_thread_subject = ? WHERE id = ?",
		).bind(threadId, now, authorName, user.userId, filteredSubject, forumId),
		env.DB.prepare("UPDATE users SET threads = threads + 1, posts = posts + 1 WHERE id = ?").bind(
			user.userId,
		),
	]);

	// Fetch created thread
	const createdThread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?")
		.bind(threadId)
		.first();

	return jsonResponse(toThread(createdThread as Record<string, unknown>), origin, undefined, 201);
});
