// User handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { toUser } from "../lib/mappers";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits";

/** GET /api/v1/users/:id - Get user by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const stmt = env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`);
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return new Response(
		JSON.stringify({
			data: toUser(result as Record<string, unknown>),
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
