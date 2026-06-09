// Post comment (点评) handlers for Cloudflare Worker

import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { canViewForumVisibility } from "@ellie/types";
import { applyCensorFilter } from "../lib/censor";
import { extractTrustedClientIp } from "../lib/clientIp";
import type { Env } from "../lib/env";
import { clampLimit } from "../lib/pagination";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import {
	buildVisibilityContext,
	canReadThreadContent,
	canViewModeratedThread,
	isForumActive,
	STICKY_MODERATED,
} from "../lib/visibility";
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

	if (!row || (row.sticky < 0 && row.sticky !== STICKY_MODERATED)) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	if (!isForumActive(row)) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const user = await userPromise;

	if (row.sticky === STICKY_MODERATED) {
		if (
			!canViewModeratedThread({
				authorId: row.author_id,
				forumModeratorIds: row.moderator_ids ?? "",
				user,
			})
		) {
			return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
		}
	} else {
		const visCtx = buildVisibilityContext(user);

		if (
			!canReadThreadContent({
				sticky: row.sticky,
				forumVisibility: row.visibility as ForumVisibility,
				visCtx,
			})
		) {
			return errorResponse(
				"FORBIDDEN",
				403,
				{ message: "You don't have access to this content" },
				origin,
			);
		}
	}

	// Clamp limit
	const clampedLimit = clampLimit(limitParam, { defaultLimit: 50, maxLimit: 100 });

	const result = await env.DB.prepare(
		"SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at ASC LIMIT ?",
	)
		.bind(postIdNum, clampedLimit)
		.all();

	const comments = result.results.map((row) => toPostComment(row as Record<string, unknown>));

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
export async function batchByPostIds(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const threadId = typeof body.threadId === "number" ? body.threadId : undefined;
	const postIds = Array.isArray(body.postIds)
		? (body.postIds as unknown[]).filter(
				(id): id is number => typeof id === "number" && !Number.isNaN(id) && id > 0,
			)
		: undefined;

	if (typeof threadId !== "number" || Number.isNaN(threadId) || threadId <= 0) {
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

	// Auth + visibility + comments: fire all in parallel (speculative).
	// Discard comments data if the visibility check denies.
	const placeholders = uniquePostIds.map(() => "?").join(",");
	const [user, visRow, commentsResult] = await Promise.all([
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
		env.DB.prepare(
			`SELECT pc.*
			 FROM post_comments pc
			 INNER JOIN posts p ON p.id = pc.post_id
			 WHERE pc.post_id IN (${placeholders}) AND p.thread_id = ? AND p.invisible = 0
			 ORDER BY pc.post_id, pc.created_at`,
		)
			.bind(...uniquePostIds, threadId)
			.all(),
	]);

	if (!visRow || (visRow.sticky < 0 && visRow.sticky !== STICKY_MODERATED)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	if (!isForumActive(visRow)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	if (visRow.sticky === STICKY_MODERATED) {
		if (
			!canViewModeratedThread({
				authorId: visRow.author_id,
				forumModeratorIds: visRow.moderator_ids ?? "",
				user,
			})
		) {
			return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
		}
	} else {
		const visCtx = buildVisibilityContext(user);

		if (
			!canReadThreadContent({
				sticky: visRow.sticky,
				forumVisibility: visRow.visibility as ForumVisibility,
				visCtx,
			})
		) {
			return errorResponse(
				"FORBIDDEN",
				403,
				{ message: "You don't have access to this content" },
				origin,
			);
		}
	}

	const comments = commentsResult.results.map((r) => toPostComment(r as Record<string, unknown>));

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
