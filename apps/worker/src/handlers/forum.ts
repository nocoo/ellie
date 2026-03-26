// Forum handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

export async function list(_request: Request, env: Env): Promise<Response> {
	const stmt = env.DB.prepare("SELECT * FROM forums ORDER BY display_order");
	const result = await stmt.all();

	return new Response(JSON.stringify(result.results), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const id = Number.parseInt(url.pathname.split("/").pop()!, 10);

	const stmt = env.DB.prepare("SELECT * FROM forums WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return new Response(JSON.stringify({ error: "Forum not found" }), {
			status: 404,
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(result), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function update(_request: Request, _env: Env): Promise<Response> {
	// TODO: Implement forum update
	return new Response(JSON.stringify({ error: "Not implemented" }), {
		status: 501,
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}
