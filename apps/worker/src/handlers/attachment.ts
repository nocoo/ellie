// Attachment handlers for Cloudflare Worker (public)

import {
	getPostAttachments,
	loadPostAccess,
	loadPostAccessBatch,
	loadThreadAccess,
	threadAccessStatus,
	validReadingId,
} from "../lib/cache/thread-loaders";
import type { Env } from "../lib/env";
import { toAttachment } from "../lib/mappers";
import { parsePathSegment } from "../lib/parseId";
import { jsonResponse } from "../lib/response";
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
	threadId: number,
	request: Request,
	env: Env,
	origin?: string,
	notFoundCode = "THREAD_NOT_FOUND",
): Promise<{ allowed: true } | { allowed: false; response: Response }> {
	const [user, row] = await Promise.all([
		optionalAuthVerified(request, env),
		loadThreadAccess(env, threadId),
	]);
	const status = threadAccessStatus(row, user);
	if (status === 404)
		return { allowed: false, response: errorResponse(notFoundCode, 404, undefined, origin) };
	if (status === 403)
		return {
			allowed: false,
			response: errorResponse(
				"FORBIDDEN",
				403,
				{ message: "You don't have access to this content" },
				origin,
			),
		};
	return { allowed: true };
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

	const visResult = await verifyThreadVisibility(threadId, request, env, origin);
	if (!visResult.allowed) return visResult.response;
	const current = await loadPostAccessBatch(env, uniquePostIds, threadId);
	const rows = await getPostAttachments(env, ctx, [...current.keys()], threadId);
	const attachments = [...rows.values()]
		.flat()
		.sort((a, b) => Number(a.post_id) - Number(b.post_id) || Number(a.id) - Number(b.id))
		.map(toAttachment);

	return jsonResponse(attachments, origin);
}

/** GET /api/v1/posts/:id/attachments - List attachments for a post */
export async function listByPost(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const postId = parsePathSegment(request, 1);

	if (postId === null || postId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	}

	const post = await loadPostAccess(env, postId);
	if (post?.invisible !== 0) return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	const visResult = await verifyThreadVisibility(
		post.thread_id,
		request,
		env,
		origin,
		"POST_NOT_FOUND",
	);
	if (!visResult.allowed) return visResult.response;
	const rows = await getPostAttachments(env, ctx, [postId], post.thread_id);
	const attachments = (rows.get(postId) ?? []).map(toAttachment);

	return jsonResponse(attachments, origin);
}
