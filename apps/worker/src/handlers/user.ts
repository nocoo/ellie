// User handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const id = Number.parseInt(url.pathname.split("/").pop()!, 10);

	const stmt = env.DB.prepare("SELECT * FROM users WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return new Response(JSON.stringify({ error: "User not found" }), {
			status: 404,
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(result), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function deleteFn(_request: Request, _env: Env): Promise<Response> {
	// TODO: Implement user deletion
	return new Response(JSON.stringify({ error: "Not implemented" }), {
		status: 501,
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

// Named export for delete (reserved keyword)
export { deleteFn as delete };
