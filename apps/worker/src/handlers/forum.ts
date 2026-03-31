import type { Forum } from "@ellie/types";
import type { Env } from "../lib/env";
import { toForum } from "../lib/mappers";

// Forum handlers for Cloudflare Worker
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Run both queries in parallel: all forums + per-forum thread count in last 24h
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

	const [forumResult, countResult] = await Promise.all([
		env.DB.prepare("SELECT * FROM forums ORDER BY display_order").all(),
		env.DB.prepare(
			"SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? GROUP BY forum_id",
		)
			.bind(cutoff24h)
			.all<{ forum_id: number; cnt: number }>(),
	]);

	// Build lookup map: forum_id → todayThreads
	const todayMap = new Map<number, number>();
	for (const row of countResult.results) {
		todayMap.set(row.forum_id, row.cnt);
	}

	const forums: Forum[] = forumResult.results.map((row) => {
		const forum = toForum(row as Record<string, unknown>);
		forum.todayThreads = todayMap.get(forum.id) ?? 0;
		return forum;
	});

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

	const forum = toForum(result as Record<string, unknown>);

	// Count threads in last 24h for this forum
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;
	const countResult = await env.DB.prepare(
		"SELECT COUNT(*) AS cnt FROM threads WHERE forum_id = ? AND created_at >= ?",
	)
		.bind(id, cutoff24h)
		.first<{ cnt: number }>();
	forum.todayThreads = countResult?.cnt ?? 0;

	return new Response(
		JSON.stringify({
			data: forum,
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
