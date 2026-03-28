// User handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { toPublicUser } from "../lib/mappers";
import { jsonResponse } from "../lib/response";
import { errorResponse } from "../middleware/error";

/** Explicit PublicUser columns — never SELECT * to avoid leaking sensitive fields */
const PUBLIC_USER_COLUMNS =
	"id, username, avatar, status, role, reg_date, last_login, threads, posts, credits";

/** GET /api/v1/users/:id - Get user public profile */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const result = await env.DB.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(id)
		.first();

	if (!result) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toPublicUser(result as Record<string, unknown>), origin);
}
