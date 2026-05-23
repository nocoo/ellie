// Attachment handlers for Cloudflare Worker (public)
import type { ForumVisibility } from "@ellie/types";
import type { Env } from "../lib/env";
import { toAttachment } from "../lib/mappers";
import { parsePathSegment } from "../lib/parseId";
import { jsonResponse } from "../lib/response";
import {
	STICKY_MODERATED,
	buildVisibilityContext,
	canReadThreadContent,
	canViewModeratedThread,
	isForumActive,
} from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Max post IDs per batch request */
const MAX_BATCH_POST_IDS = 100;

/**
 * Verify that a thread is visible and its forum is accessible to the viewer.
 * Shared by both listByPost and batchByPostIds to prevent visibility SQL drift.
 *
 * @param notFoundCode - Error code for "not found" responses (default: THREAD_NOT_FOUND).
 *   listByPost passes POST_NOT_FOUND to preserve post-centric error semantics.
 *
 * Returns { allowed: true, forumId } on success, or { allowed: false, response } on failure.
 */
async function verifyThreadVisibility(
	db: D1Database,
	threadId: number,
	request: Request,
	env: Env,
	origin?: string,
	notFoundCode = "THREAD_NOT_FOUND",
): Promise<{ allowed: true; forumId: number } | { allowed: false; response: Response }> {
	// Auth lookup is independent of the thread/forum chain — fire it eagerly
	// so it overlaps with the thread + forum queries below. Saves one D1 RTT
	// in production when the caller is logged in.
	const userPromise = optionalAuthVerified(request, env);

	// Check thread visibility (sticky >= 0 or moderated)
	const thread = await db
		.prepare("SELECT forum_id, sticky, author_id FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ forum_id: number; sticky: number; author_id: number }>();

	if (!thread || (thread.sticky < 0 && thread.sticky !== STICKY_MODERATED)) {
		return { allowed: false, response: errorResponse(notFoundCode, 404, undefined, origin) };
	}

	// Check forum status and visibility
	const forumRow = await db
		.prepare("SELECT status, visibility, moderator_ids FROM forums WHERE id = ?")
		.bind(thread.forum_id)
		.first<{ status: number; visibility: string; moderator_ids: string }>();

	if (!isForumActive(forumRow)) {
		return { allowed: false, response: errorResponse(notFoundCode, 404, undefined, origin) };
	}

	// Resolve auth (already in-flight)
	const user = await userPromise;

	if (thread.sticky === STICKY_MODERATED) {
		if (
			!canViewModeratedThread({
				authorId: thread.author_id,
				forumModeratorIds: forumRow.moderator_ids ?? "",
				user,
			})
		) {
			return { allowed: false, response: errorResponse(notFoundCode, 404, undefined, origin) };
		}
	} else {
		const visCtx = buildVisibilityContext(user);

		if (
			!canReadThreadContent({
				sticky: thread.sticky,
				forumVisibility: forumRow.visibility as ForumVisibility,
				visCtx,
			})
		) {
			return {
				allowed: false,
				response: errorResponse(
					"FORBIDDEN",
					403,
					{ message: "You don't have access to this content" },
					origin,
				),
			};
		}
	}

	return { allowed: true, forumId: thread.forum_id };
}

/**
 * POST /api/v1/posts/attachments/batch - Batch attachment fetch for multiple posts
 *
 * Body: { postIds: number[], threadId: number }
 * - Validates all postIds belong to the specified thread and are visible
 * - Single thread→forum visibility check (not per-post)
 * - Returns all attachments for the specified posts in one query
 * - Caps at 100 post IDs
 *
 * Designed to eliminate N+1 per-post attachment fetches in thread detail pages.
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

	// Visibility check + attachments query are independent — fire both in
	// parallel and discard the data if the visibility check denies. Worth
	// the speculative work because the authorised case is by far the common
	// one and saves up to 1 D1 RTT.
	const attPlaceholders = uniquePostIds.map(() => "?").join(",");
	const [visResult, result] = await Promise.all([
		verifyThreadVisibility(env.DB, threadId, request, env, origin),
		env.DB.prepare(
			`SELECT a.*
			 FROM attachments a
			 INNER JOIN posts p ON p.id = a.post_id
			 WHERE a.post_id IN (${attPlaceholders}) AND p.thread_id = ? AND p.invisible = 0
			 ORDER BY a.post_id, a.id`,
		)
			.bind(...uniquePostIds, threadId)
			.all(),
	]);
	if (!visResult.allowed) {
		return visResult.response;
	}

	const attachments = result.results.map((row) => toAttachment(row as Record<string, unknown>));

	return jsonResponse(attachments, origin);
}

/** GET /api/v1/posts/:id/attachments - List attachments for a post */
export async function listByPost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const postId = parsePathSegment(request, 1);

	if (postId === null || postId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	}

	// Run the post lookup and attachments query in parallel — attachments
	// query is keyed only on postId so it doesn't need the post row to start.
	// We still gate the response behind the visibility chain below.
	const [post, attachmentResult] = await Promise.all([
		env.DB.prepare("SELECT thread_id, invisible FROM posts WHERE id = ?")
			.bind(postId)
			.first<{ thread_id: number; invisible: number }>(),
		env.DB.prepare("SELECT * FROM attachments WHERE post_id = ? ORDER BY id").bind(postId).all(),
	]);

	if (!post || post.invisible !== 0) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Use shared visibility check for thread→forum chain
	// Pass POST_NOT_FOUND to preserve post-centric error semantics
	const visResult = await verifyThreadVisibility(
		env.DB,
		post.thread_id,
		request,
		env,
		origin,
		"POST_NOT_FOUND",
	);
	if (!visResult.allowed) {
		return visResult.response;
	}

	const attachments = attachmentResult.results.map((row) =>
		toAttachment(row as Record<string, unknown>),
	);

	return jsonResponse(attachments, origin);
}
