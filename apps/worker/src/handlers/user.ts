import type { User } from "@ellie/types";
// User handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** GET /api/v1/users/:id - Get user by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const stmt = env.DB.prepare("SELECT * FROM users WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("USER_NOT_FOUND", 404);
	}

	return new Response(
		JSON.stringify({
			data: result as unknown as User,
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

/** DELETE /api/v1/users/:id - Delete user (admin only, requires auth) */
export async function deleteFn(_request: Request, _env: Env): Promise<Response> {
	// TODO: Implement user deletion with auth and admin check
	return errorResponse("NOT_IMPLEMENTED", 501);
}

// Named export for delete (reserved keyword)
export { deleteFn as delete };
