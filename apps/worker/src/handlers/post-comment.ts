// Post comment (点评) handlers for Cloudflare Worker

import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { canViewForumVisibility } from "@ellie/types";
import {
	getPostComments,
	loadPostAccessBatch,
	threadAccessStatus,
	validReadingId,
} from "../lib/cache/thread-loaders";
import { applyCensorFilter } from "../lib/censor";
import { extractTrustedClientIp } from "../lib/clientIp";
import type { Env } from "../lib/env";
import { clampLimit } from "../lib/pagination";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { getUserProfiles } from "../lib/user-cache";
import { isForumActive } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Max post IDs per batch request */
const MAX_BATCH_POST_IDS = 100;

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
export async function list(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const postId = url.searchParams.get("postId");
	const limitParam = url.searchParams.get("limit");

	if (!postId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "postId is required" }, origin);
	}

	const postIdNum = Number.parseInt(postId, 10);
	if (!validReadingId(postIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid postId" }, origin);
	}

	// Auth lookup is independent of the post visibility chain — fire eagerly
	// so it overlaps in production. We need it before the visibility check.
	const userPromise = optionalAuthVerified(request, env);

	// Single JOIN query: post → thread → forum (replaces 3 serial queries)
	const row = await env.DB.prepare(
		`SELECT t.forum_id, t.sticky, t.author_id, f.status, f.visibility, f.moderator_ids
		 FROM posts p
		 JOIN threads t ON t.id = p.thread_id
		 JOIN forums f ON f.id = t.forum_id
		 WHERE p.id = ? AND p.invisible = 0`,
	)
		.bind(postIdNum)
		.first<{
			forum_id: number;
			sticky: number;
			author_id: number;
			status: number;
			visibility: string;
			moderator_ids: string;
		}>();

	const access = threadAccessStatus(row, await userPromise);
	if (access === 404) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}
	if (access === 403) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	}

	// Clamp limit
	const clampedLimit = clampLimit(limitParam, { defaultLimit: 50, maxLimit: 100 });

	if (!Number.isSafeInteger(clampedLimit))
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid limit" }, origin);
	const rows = await getPostComments(env, ctx, [postIdNum], clampedLimit);
	const comments = (rows.get(postIdNum) ?? []).map(toPostComment);
	const profiles = await getUserProfiles(
		env,
		ctx,
		comments.map((comment) => comment.authorId),
	);
	for (const comment of comments)
		comment.authorName = profiles.get(comment.authorId)?.username ?? comment.authorName;

	return jsonResponse(comments, origin);
}

/**
 * POST /api/v1/post-comments/batch - Batch comment fetch for multiple posts
 *
 * Body: { threadId: number, postIds: number[] }
 * - Validates all postIds belong to the specified thread and are visible
 * - Single thread→forum visibility check (not per-post)
 * - Returns all comments for the specified posts in one query
 * - Caps at 100 post IDs
 *
 * Designed to eliminate N+1 per-post comment fetches in thread detail pages.
 */
export async function batchByPostIds(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const threadId = typeof body.threadId === "number" ? body.threadId : undefined;
	const postIds = Array.isArray(body.postIds)
		? (body.postIds as unknown[]).filter(validReadingId)
		: undefined;

	if (!validReadingId(threadId)) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "threadId is required (positive number)" },
			origin,
		);
	}

	if (!postIds || postIds.length === 0) {
		return jsonResponse([], origin);
	}

	// Deduplicate
	const uniquePostIds = [...new Set(postIds)];

	if (uniquePostIds.length > MAX_BATCH_POST_IDS) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: `Too many postIds (max ${MAX_BATCH_POST_IDS})` },
			origin,
		);
	}

	// Authorize before reading cached comments; the post gate below also
	// validates current ownership and deletion with at most 100 bindings.
	const [user, visRow] = await Promise.all([
		optionalAuthVerified(request, env),
		env.DB.prepare(
			`SELECT t.forum_id, t.sticky, t.author_id, f.status, f.visibility, f.moderator_ids
			 FROM threads t
			 JOIN forums f ON f.id = t.forum_id
			 WHERE t.id = ?`,
		)
			.bind(threadId)
			.first<{
				forum_id: number;
				sticky: number;
				author_id: number;
				status: number;
				visibility: string;
				moderator_ids: string;
			}>(),
	]);

	const access = threadAccessStatus(visRow, user);
	if (access === 404) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}
	if (access === 403) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	}

	const current = await loadPostAccessBatch(env, uniquePostIds, threadId);
	const rows = await getPostComments(env, ctx, [...current.keys()], null);
	const comments = [...rows.values()]
		.flat()
		.sort(
			(a, b) =>
				Number(a.post_id) - Number(b.post_id) ||
				Number(a.created_at) - Number(b.created_at) ||
				Number(a.id) - Number(b.id),
		)
		.map(toPostComment);
	const profiles = await getUserProfiles(
		env,
		ctx,
		comments.map((comment) => comment.authorId),
	);
	for (const comment of comments)
		comment.authorName = profiles.get(comment.authorId)?.username ?? comment.authorName;

	return jsonResponse(comments, origin);
}

/** POST /api/v1/post-comments - Create a comment on a post (requires auth) */
export const create = withVerifiedEmail(async (request, env, user) => {
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

	// Visibility JOIN + author-name lookup are independent — fire in parallel.
	const [row, authorRow] = await Promise.all([
		env.DB.prepare(
			`SELECT p.thread_id, t.closed, t.sticky, t.forum_id, f.status, f.visibility
			 FROM posts p
			 JOIN threads t ON t.id = p.thread_id
			 JOIN forums f ON f.id = t.forum_id
			 WHERE p.id = ? AND p.invisible = 0`,
		)
			.bind(postId)
			.first<{
				thread_id: number;
				closed: number;
				sticky: number;
				forum_id: number;
				status: number;
				visibility: string;
			}>(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
	]);

	if (!row || row.sticky < 0) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	if (row.closed === 1) {
		return errorResponse("THREAD_CLOSED", 403, undefined, origin);
	}

	if (!isForumActive(row)) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Check forum visibility - user must have access to comment in this forum
	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	if (!canViewForumVisibility(row.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to comment in this thread" },
			origin,
		);
	}

	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Use the unified trusted-IP extractor; server-to-Worker BFF calls
	// (forum-api.ts) forward the user's real IP via `X-Real-IP` and would
	// otherwise be lost since `CF-Connecting-IP` reflects the BFF egress.
	// Empty string remains acceptable when no trusted source is present.
	const ip = extractTrustedClientIp(request, env) ?? "";

	// Insert comment
	const insertResult = await env.DB.prepare(
		`INSERT INTO post_comments (thread_id, post_id, author_id, author_name, content, score, reply_post_id, ip, created_at)
		 VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`,
	)
		.bind(row.thread_id, postId, user.userId, authorName, content, ip, now)
		.run();

	if (!insertResult.success) throw new Error("Comment creation was not confirmed");
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
