// Post handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

export async function list(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const threadId = url.searchParams.get("threadId");
	const limit = Number.parseInt(url.searchParams.get("limit") || "20", 10);

	let stmt;
	let result;

	if (threadId) {
		stmt = env.DB.prepare("SELECT * FROM posts WHERE thread_id = ? ORDER BY created_at LIMIT ?");
		result = await stmt.bind(Number(threadId), limit).all();
	} else {
		// Return error if no threadId specified
		return new Response(JSON.stringify({ error: "threadId parameter required" }), {
			status: 400,
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(result.results), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const id = Number.parseInt(url.pathname.split("/").pop()!, 10);

	const stmt = env.DB.prepare("SELECT * FROM posts WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return new Response(JSON.stringify({ error: "Post not found" }), {
			status: 404,
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		});
	}

	return new Response(JSON.stringify(result), {
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}

export async function create(_request: Request, _env: Env): Promise<Response> {
	// TODO: Implement post creation
	return new Response(JSON.stringify({ error: "Not implemented" }), {
		status: 501,
		headers: { ...corsHeaders(), "Content-Type": "application/json" },
	});
}
