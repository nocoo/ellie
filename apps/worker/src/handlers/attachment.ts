// Attachment handlers for Cloudflare Worker (public)
import { canViewForumVisibility } from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import type { Env } from "../lib/env";
import { toAttachment } from "../lib/mappers";
import { jsonResponse } from "../lib/response";
import { buildVisibilityContext, isForumActive } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
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

	// Check thread visibility (sticky >= 0)
	const thread = await db
		.prepare("SELECT forum_id, sticky FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ forum_id: number; sticky: number }>();

	if (!thread || thread.sticky < 0) {
		return { allowed: false, response: errorResponse(notFoundCode, 404, undefined, origin) };
	}

	// Check forum status and visibility
	const forumRow = await db
		.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(thread.forum_id)
		.first<{ status: number; visibility: string }>();

	if (!isForumActive(forumRow)) {
		return { allowed: false, response: errorResponse(notFoundCode, 404, undefined, origin) };
	}

	// Resolve auth (already in-flight)
	const user = await userPromise;
	const visCtx = buildVisibilityContext(user);

	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
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

	// Verify thread visibility (single check for the whole batch)
	const visResult = await verifyThreadVisibility(env.DB, threadId, request, env, origin);
	if (!visResult.allowed) {
		return visResult.response;
	}

	// Verify all posts belong to this thread and are visible (invisible = 0)
	const postPlaceholders = uniquePostIds.map(() => "?").join(",");
	const postsResult = await env.DB.prepare(
		`SELECT id FROM posts WHERE id IN (${postPlaceholders}) AND thread_id = ? AND invisible = 0`,
	)
		.bind(...uniquePostIds, threadId)
		.all<{ id: number }>();

	const validPostIds = new Set(postsResult.results.map((r) => r.id));

	// Filter to only valid posts (silently ignore invalid/hidden posts)
	const filteredPostIds = uniquePostIds.filter((id) => validPostIds.has(id));

	if (filteredPostIds.length === 0) {
		return jsonResponse([], origin);
	}

	// Fetch all attachments for valid posts in a single query
	const attPlaceholders = filteredPostIds.map(() => "?").join(",");
	const result = await env.DB.prepare(
		`SELECT * FROM attachments WHERE post_id IN (${attPlaceholders}) ORDER BY post_id, id`,
	)
		.bind(...filteredPostIds)
		.all();

	const attachments = result.results.map((row) => toAttachment(row as Record<string, unknown>));

	return jsonResponse(attachments, origin);
}

/** GET /api/v1/posts/:id/attachments - List attachments for a post */
export async function listByPost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	// /api/v1/posts/:id/attachments → posts is at [-3], id at [-2]
	const idStr = pathParts[pathParts.length - 2];
	const postId = Number.parseInt(idStr ?? "0", 10);

	if (Number.isNaN(postId) || postId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	}

	// Get post's thread_id and check if post is visible (invisible = 0)
	const post = await env.DB.prepare("SELECT thread_id, invisible FROM posts WHERE id = ?")
		.bind(postId)
		.first<{ thread_id: number; invisible: number }>();

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

	const result = await env.DB.prepare("SELECT * FROM attachments WHERE post_id = ? ORDER BY id")
		.bind(postId)
		.all();

	const attachments = result.results.map((row) => toAttachment(row as Record<string, unknown>));

	return new Response(
		JSON.stringify({
			data: attachments,
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
