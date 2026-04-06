// Attachment handlers for Cloudflare Worker (public)
import { canViewForumVisibility } from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import type { Env } from "../lib/env";
import { toAttachment } from "../lib/mappers";
import { buildVisibilityContext } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

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

	// Get thread's forum_id and check if thread is visible (sticky >= 0)
	const thread = await env.DB.prepare("SELECT forum_id, sticky FROM threads WHERE id = ?")
		.bind(post.thread_id)
		.first<{ forum_id: number; sticky: number }>();

	if (!thread || thread.sticky < 0) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Check forum visibility
	const forumRow = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(thread.forum_id)
		.first<{ status: number; visibility: string }>();

	if (!forumRow || forumRow.status <= 0 || forumRow.status === 2 || forumRow.status === 3) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Get user auth for visibility check (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
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
