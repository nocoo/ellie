// Post handlers for Cloudflare Worker
import { canViewForumVisibility, decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { applyCensorFilter } from "../lib/censor";
import type { Env } from "../lib/env";
import { toPost } from "../lib/mappers";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withAuthVerified } from "../lib/routeHelpers";
import { POST_VISIBLE, buildVisibilityContext } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Post cursor payload for keyset pagination */
interface PostCursorPayload {
	position: number;
}

/** Validate post cursor payload shape */
function isPostCursor(p: Partial<PostCursorPayload>): boolean {
	return typeof p.position === "number";
}

/** GET /api/v1/posts - List posts with position-based pagination */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const threadId = url.searchParams.get("threadId");
	const limitParam = url.searchParams.get("limit");
	const cursorStr = url.searchParams.get("cursor");

	if (!threadId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "threadId is required" }, origin);
	}

	const threadIdNum = Number.parseInt(threadId, 10);
	if (Number.isNaN(threadIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid threadId" }, origin);
	}

	// Check forum visibility before listing posts (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	// Get forum info via thread, also check thread is visible (sticky >= 0)
	const threadRow = await env.DB.prepare("SELECT forum_id, sticky FROM threads WHERE id = ?")
		.bind(threadIdNum)
		.first<{ forum_id: number; sticky: number }>();

	if (!threadRow || threadRow.sticky < 0) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const forumRow = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(threadRow.forum_id)
		.first<{ status: number; visibility: string }>();

	if (!forumRow || forumRow.status <= 0 || forumRow.status === 2 || forumRow.status === 3) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	}

	// Clamp limit to [1, 100], defaulting to 100
	const DEFAULT_PAGE_SIZE = 100;
	const MAX_PAGE_SIZE = 100;
	const limitNum = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	const clampedLimit =
		limitNum === undefined || limitNum <= 0 ? DEFAULT_PAGE_SIZE : Math.min(limitNum, MAX_PAGE_SIZE);

	const cursor = cursorStr
		? decodeGenericCursor<PostCursorPayload>(cursorStr, isPostCursor)
		: null;

	let result: D1Result;
	if (cursor) {
		// Position-based pagination: WHERE thread_id = ? AND position > ? ORDER BY position
		// Only return visible posts (invisible = 0)
		const stmt = env.DB.prepare(
			`SELECT * FROM posts WHERE thread_id = ? AND ${POST_VISIBLE} AND position > ? ORDER BY position LIMIT ?`,
		);
		result = await stmt.bind(threadIdNum, cursor.position, clampedLimit).all();
	} else {
		// First page - only return visible posts (invisible = 0)
		const stmt = env.DB.prepare(
			`SELECT * FROM posts WHERE thread_id = ? AND ${POST_VISIBLE} ORDER BY position LIMIT ?`,
		);
		result = await stmt.bind(threadIdNum, clampedLimit).all();
	}

	// Map D1 snake_case rows to camelCase Post type
	const posts = result.results.map((row) => toPost(row as Record<string, unknown>));

	// Generate next cursor from raw D1 row (position is same in both)
	let nextCursor: string | null = null;
	if (posts.length === clampedLimit && posts.length > 0) {
		const lastPost = posts[posts.length - 1];
		if (lastPost) {
			nextCursor = encodeGenericCursor<PostCursorPayload>({
				position: lastPost.position,
			});
		}
	}

	return new Response(
		JSON.stringify({
			data: posts,
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

/** GET /api/v1/posts/:id - Get post by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	// Only return visible posts (invisible = 0)
	const stmt = env.DB.prepare(`SELECT * FROM posts WHERE id = ? AND ${POST_VISIBLE}`);
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const postRow = result as Record<string, unknown>;
	const threadId = postRow.thread_id as number;

	// Check thread visibility (sticky >= 0) and forum visibility
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	const threadRow = await env.DB.prepare("SELECT forum_id, sticky FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ forum_id: number; sticky: number }>();

	if (!threadRow || threadRow.sticky < 0) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const forumRow = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(threadRow.forum_id)
		.first<{ status: number; visibility: string }>();

	if (!forumRow || forumRow.status <= 0 || forumRow.status === 2 || forumRow.status === 3) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	}

	return new Response(
		JSON.stringify({
			data: toPost(postRow),
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

/** POST /api/v1/posts - Reply to a thread (requires auth) */
export const create = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Check posting permission (banned, muted, registration days, avatar, content switch)
	const permissionResult = await checkPostingPermission(env, user, origin, "reply");
	if (!permissionResult.allowed) {
		return permissionResult.error;
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const threadId = typeof body.threadId === "number" ? body.threadId : undefined;
	let content = typeof body.content === "string" ? body.content : undefined;

	if (typeof threadId !== "number" || Number.isNaN(threadId)) {
		return errorResponse("INVALID_BODY", 400, { message: "threadId is required (number)" }, origin);
	}
	if (!content || content.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "content is required" }, origin);
	}

	// Censor word check
	const censorResult = await applyCensorFilter(content.trim(), env);
	if (censorResult.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	content = censorResult.content;

	// Validate thread exists and is not closed
	const thread = await env.DB.prepare("SELECT id, forum_id, closed FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ id: number; forum_id: number; closed: number }>();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}
	if (thread.closed === 1) {
		return errorResponse("THREAD_CLOSED", 403, undefined, origin);
	}

	// Check forum visibility - user must have access to post in this forum
	const forumRow = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(thread.forum_id)
		.first<{ status: number; visibility: string }>();

	if (!forumRow || forumRow.status <= 0 || forumRow.status === 2 || forumRow.status === 3) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to reply in this thread" },
			origin,
		);
	}

	// Get next position
	const posResult = await env.DB.prepare(
		"SELECT MAX(position) as maxPos FROM posts WHERE thread_id = ?",
	)
		.bind(threadId)
		.first<{ maxPos: number | null }>();
	const nextPosition = (posResult?.maxPos ?? 0) + 1;

	// Fetch author name from users table
	const authorRow = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ username: string }>();
	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Insert post
	const postResult = await env.DB.prepare(
		"INSERT INTO posts (thread_id, forum_id, author_id, author_name, content, created_at, is_first, position) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
	)
		.bind(threadId, thread.forum_id, user.userId, authorName, content, now, nextPosition)
		.run();

	const postId = postResult.meta.last_row_id;

	// Batch update counts (with last_poster_id)
	await env.DB.batch([
		env.DB.prepare(
			"UPDATE threads SET replies = replies + 1, last_post_at = ?, last_poster = ?, last_poster_id = ? WHERE id = ?",
		).bind(now, authorName, user.userId, threadId),
		env.DB.prepare(
			"UPDATE forums SET posts = posts + 1, last_post_at = ?, last_poster = ?, last_poster_id = ? WHERE id = ?",
		).bind(now, authorName, user.userId, thread.forum_id),
		env.DB.prepare("UPDATE users SET posts = posts + 1 WHERE id = ?").bind(user.userId),
	]);

	// Fetch created post
	const createdPost = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first();

	return jsonResponse(toPost(createdPost as Record<string, unknown>), origin, undefined, 201);
});
