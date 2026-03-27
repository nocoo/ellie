// Attachment handlers for Cloudflare Worker (public)
import type { Env } from "../lib/env";
import { toAttachment } from "../lib/mappers";
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
