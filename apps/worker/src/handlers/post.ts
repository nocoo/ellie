import type { Post } from "@ellie/types";
// Post handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Post cursor payload for keyset pagination */
interface PostCursorPayload {
	position: number;
}

/** Encode post cursor to base64 */
function encodePostCursor(payload: PostCursorPayload): string {
	return btoa(JSON.stringify(payload));
}

/** Decode post cursor from base64 */
function decodePostCursor(cursor: string): PostCursorPayload | null {
	try {
		const json = atob(cursor);
		const parsed = JSON.parse(json) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"position" in parsed &&
			typeof (parsed as PostCursorPayload).position === "number"
		) {
			return parsed as PostCursorPayload;
		}
		return null;
	} catch {
		return null;
	}
}

/** GET /api/v1/posts - List posts with position-based pagination */
export async function list(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const threadId = url.searchParams.get("threadId");
	const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
	const cursorStr = url.searchParams.get("cursor");

	// Clamp limit to [1, 50], defaulting to 20
	const DEFAULT_PAGE_SIZE = 20;
	const MAX_PAGE_SIZE = 50;
	const limitNum = limit ? Number.parseInt(String(limit), 10) : undefined;
	const clampedLimit =
		limitNum === undefined || limitNum <= 0 ? DEFAULT_PAGE_SIZE : Math.min(limitNum, MAX_PAGE_SIZE);

	if (!threadId) {
		return errorResponse("INVALID_REQUEST", 400, {
			message: "threadId is required",
		});
	}

	const threadIdNum = Number.parseInt(threadId, 10);
	if (Number.isNaN(threadIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, {
			message: "Invalid threadId",
		});
	}

	const cursor = cursorStr ? decodePostCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		// Position-based pagination: WHERE thread_id = ? AND position > ? ORDER BY position
		const stmt = env.DB.prepare(
			"SELECT * FROM posts WHERE thread_id = ? AND position > ? ORDER BY position LIMIT ?",
		);
		result = await stmt.bind(threadIdNum, cursor.position, clampedLimit).all();
	} else {
		// First page
		const stmt = env.DB.prepare(
			"SELECT * FROM posts WHERE thread_id = ? ORDER BY position LIMIT ?",
		);
		result = await stmt.bind(threadIdNum, clampedLimit).all();
	}

	const posts = result.results as unknown as Post[];

	// Generate next cursor if we have more results
	let nextCursor: string | undefined;
	if (posts.length === clampedLimit && posts.length > 0) {
		const lastPost = posts[posts.length - 1];
		if (lastPost) {
			nextCursor = encodePostCursor({
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
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		},
	);
}

/** GET /api/v1/posts/:id - Get post by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const stmt = env.DB.prepare("SELECT * FROM posts WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("POST_NOT_FOUND", 404);
	}

	return new Response(
		JSON.stringify({
			data: result as unknown as Post,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
			},
		}),
		{
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		},
	);
}

/** POST /api/v1/posts - Create a new post (requires auth) */
export async function create(_request: Request, _env: Env): Promise<Response> {
	// TODO: Implement post creation with auth
	return errorResponse("NOT_IMPLEMENTED", 501);
}
