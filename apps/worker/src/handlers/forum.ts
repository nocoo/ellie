import type { Forum } from "@ellie/types";
import type { Env } from "../lib/env";

// Forum handlers for Cloudflare Worker
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(_request: Request, env: Env): Promise<Response> {
	const stmt = env.DB.prepare("SELECT * FROM forums ORDER BY display_order");
	const result = await stmt.all();

	// Convert snake_case from D1 to camelCase for frontend
	const forums: Forum[] = result.results as Forum[];

	return new Response(
		JSON.stringify({
			data: forums,
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

/** GET /api/v1/forums/:id - Get forum by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const stmt = env.DB.prepare("SELECT * FROM forums WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("FORUM_NOT_FOUND", 404);
	}

	return new Response(
		JSON.stringify({
			data: result as Forum,
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
