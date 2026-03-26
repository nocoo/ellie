// Ellie API Worker — Cloudflare Worker middleware for D1 access
import type { CFRequest, Env } from "./lib/env";
import { corsHeaders } from "./middleware/cors";

// ─── Router ───────────────────────────────────────────────────────

export type { CFRequest, Env };

export default {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: flat router if-chain is intentionally sequential
	async fetch(request: CFRequest, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const origin = request.headers.get("Origin") ?? undefined;

		// CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(origin),
			});
		}

		// Route handling — use `return await` so that rejections
		// from handler promises are caught by the try/catch below.
		try {
			// Health check (no auth, no cache)
			if (path === "/api/live" && request.method === "GET") {
				return await (await import("./handlers/live")).live(request, env);
			}

			// Public routes
			if (path === "/api/v1/forums" && request.method === "GET") {
				return await (await import("./handlers/forum")).list(request, env);
			}
			if (path.match(/^\/api\/v1\/forums\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/forum")).getById(request, env);
			}
			if (path === "/api/v1/threads" && request.method === "GET") {
				return await (await import("./handlers/thread")).list(request, env);
			}
			if (path.match(/^\/api\/v1\/threads\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/thread")).getById(request, env);
			}
			if (path === "/api/v1/posts" && request.method === "GET") {
				return await (await import("./handlers/post")).list(request, env);
			}
			if (path.match(/^\/api\/v1\/posts\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/post")).getById(request, env);
			}
			if (path.match(/^\/api\/v1\/users\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/user")).getById(request, env);
			}

			// Auth routes
			if (path === "/api/v1/auth/login" && request.method === "POST") {
				return await (await import("./handlers/auth")).login(request, env);
			}

			// Authenticated routes (TODO: add auth middleware)
			if (path === "/api/v1/threads" && request.method === "POST") {
				return await (await import("./handlers/thread")).create(request, env);
			}
			if (path === "/api/v1/posts" && request.method === "POST") {
				return await (await import("./handlers/post")).create(request, env);
			}

			// Admin routes
			if (path.match(/^\/api\/admin\/forums\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/forum")).update(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/user")).delete(request, env);
			}

			// 404
			return new Response(JSON.stringify({ error: "Not found", path }), {
				status: 404,
				headers: {
					...corsHeaders(origin),
					"Content-Type": "application/json",
				},
			});
		} catch (err) {
			return new Response(
				JSON.stringify({
					error: "Internal server error",
					message: err instanceof Error ? err.message : String(err),
				}),
				{
					status: 500,
					headers: {
						...corsHeaders(origin),
						"Content-Type": "application/json",
					},
				},
			);
		}
	},
};
