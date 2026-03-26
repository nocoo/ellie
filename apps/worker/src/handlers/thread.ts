// Thread handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

export async function list(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const forumId = url.searchParams.get("forumId");
	const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
	const _cursor = url.searchParams.get("cursor");

	let stmt;
	if (forumId) {
		stmt = env.DB.prepare(
			"SELECT * FROM threads WHERE forum_id = ? ORDER BY last_post_at DESC LIMIT ?",
		);
		const _result = await stmt.bind(Number(forumId), limit).all();
	} else {
		stmt = env.DB.prepare("SELECT * FROM threads ORDER BY last_post_at DESC LIMIT ?");
		const _result = await stmt.bind(limit).all();
	}

	return new Response(JSON.stringify(result.results), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const id = Number.parseInt(url.pathname.split("/").pop()!, 10);

	const stmt = env.DB.prepare("SELECT * FROM threads WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return new Response(JSON.stringify({ error: "Thread not found" }), {
			status: 404,
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(result), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function create(_request: Request, _env: Env): Promise<Response> {
	// TODO: Implement thread creation
	return new Response(JSON.stringify({ error: "Not implemented" }), {
		status: 501,
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}
