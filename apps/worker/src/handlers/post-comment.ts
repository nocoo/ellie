// Post comment (点评) handlers for Cloudflare Worker
import { canViewForumVisibility } from "@ellie/types";
import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { applyCensorFilter } from "../lib/censor";
import type { Env } from "../lib/env";
import { jsonResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { buildVisibilityContext } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Map D1 row to API response format */
function toPostComment(row: Record<string, unknown>) {
	return {
		id: row.id as number,
		threadId: row.thread_id as number,
		postId: row.post_id as number,
		authorId: row.author_id as number,
		authorName: row.author_name as string,
		content: row.content as string,
		score: row.score as number,
		replyPostId: row.reply_post_id as number,
		createdAt: row.created_at as number,
	};
}

/** GET /api/v1/post-comments - List comments for a post */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const postId = url.searchParams.get("postId");
	const limitParam = url.searchParams.get("limit");

	if (!postId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "postId is required" }, origin);
	}

	const postIdNum = Number.parseInt(postId, 10);
	if (Number.isNaN(postIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid postId" }, origin);
	}

	// Verify post exists and is visible
	const postRow = await env.DB.prepare("SELECT thread_id FROM posts WHERE id = ? AND invisible = 0")
		.bind(postIdNum)
		.first<{ thread_id: number }>();

	if (!postRow) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Check forum visibility
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	const threadRow = await env.DB.prepare("SELECT forum_id, sticky FROM threads WHERE id = ?")
		.bind(postRow.thread_id)
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

	// Clamp limit
	const DEFAULT_LIMIT = 50;
	const MAX_LIMIT = 100;
	const limitNum = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	const clampedLimit =
		limitNum === undefined || limitNum <= 0 ? DEFAULT_LIMIT : Math.min(limitNum, MAX_LIMIT);

	const result = await env.DB.prepare(
		"SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT ?",
	)
		.bind(postIdNum, clampedLimit)
		.all();

	const comments = result.results.map((row) => toPostComment(row as Record<string, unknown>));

	return new Response(
		JSON.stringify({
			data: comments,
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

/** POST /api/v1/post-comments - Create a comment on a post (requires auth) */
export const create = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Check user status from database (banned users cannot comment)
	const userRow = await env.DB.prepare("SELECT status FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ status: number }>();

	if (!userRow || userRow.status < 0) {
		return errorResponse("FORBIDDEN", 403, { message: "You cannot post comments" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const postId = typeof body.postId === "number" ? body.postId : undefined;
	let content = typeof body.content === "string" ? body.content : undefined;

	if (typeof postId !== "number" || Number.isNaN(postId)) {
		return errorResponse("INVALID_BODY", 400, { message: "postId is required (number)" }, origin);
	}
	if (!content || content.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "content is required" }, origin);
	}

	// Limit content length (点评 is short)
	const MAX_COMMENT_LENGTH = 255;
	if (content.length > MAX_COMMENT_LENGTH) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: `Comment too long (max ${MAX_COMMENT_LENGTH} chars)` },
			origin,
		);
	}

	// Censor word check
	const censorResult = await applyCensorFilter(content.trim(), env);
	if (censorResult.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	content = censorResult.content;

	// Verify post exists and is visible
	const postRow = await env.DB.prepare(
		"SELECT id, thread_id, forum_id FROM posts WHERE id = ? AND invisible = 0",
	)
		.bind(postId)
		.first<{ id: number; thread_id: number; forum_id: number }>();

	if (!postRow) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Check thread is not closed
	const threadRow = await env.DB.prepare(
		"SELECT closed, sticky, forum_id FROM threads WHERE id = ?",
	)
		.bind(postRow.thread_id)
		.first<{ closed: number; sticky: number; forum_id: number }>();

	if (!threadRow || threadRow.sticky < 0) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	if (threadRow.closed === 1) {
		return errorResponse("THREAD_CLOSED", 403, undefined, origin);
	}

	// Check forum visibility - user must have access to comment in this forum
	const forumRow = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(threadRow.forum_id)
		.first<{ status: number; visibility: string }>();

	if (!forumRow || forumRow.status <= 0 || forumRow.status === 2 || forumRow.status === 3) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to comment in this thread" },
			origin,
		);
	}

	// Fetch author name from users table
	const authorRow = await env.DB.prepare("SELECT username FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ username: string }>();
	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Get client IP (if available from CF headers)
	const ip = request.headers.get("CF-Connecting-IP") ?? "";

	// Insert comment
	const insertResult = await env.DB.prepare(
		`INSERT INTO post_comments (thread_id, post_id, author_id, author_name, content, score, reply_post_id, ip, created_at)
		 VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
	)
		.bind(postRow.thread_id, postId, user.userId, authorName, content, ip, now)
		.run();

	const commentId = insertResult.meta.last_row_id;

	// Fetch created comment
	const createdComment = await env.DB.prepare("SELECT * FROM post_comments WHERE id = ?")
		.bind(commentId)
		.first();

	return jsonResponse(
		toPostComment(createdComment as Record<string, unknown>),
		origin,
		undefined,
		201,
	);
});
