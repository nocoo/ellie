import type { Env } from "../lib/env";
import { toForum } from "../lib/mappers";

// Forum handlers for Cloudflare Worker
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const stmt = env.DB.prepare("SELECT * FROM forums ORDER BY display_order");
	const result = await stmt.all();

	const forums = result.results.map((row) => toForum(row as Record<string, unknown>));

	return new Response(
		JSON.stringify({
			data: forums,
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

/** GET /api/v1/forums/:id - Get forum by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const stmt = env.DB.prepare("SELECT * FROM forums WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	return new Response(
		JSON.stringify({
			data: toForum(result as Record<string, unknown>),
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

/** PATCH /api/admin/forums/:id - Update forum (admin only) */
export async function update(request: Request, _env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	// TODO: Implement forum update with auth and admin check
	return errorResponse("NOT_IMPLEMENTED", 501, undefined, origin);
}
