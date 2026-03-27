// Ellie API Worker — Cloudflare Worker middleware for D1 access
import type { CFRequest, Env } from "./lib/env";
import { validateApiKey } from "./middleware/apiKey";
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

			// API Key gate — all routes below require a valid X-API-Key header
			const apiKeyError = validateApiKey(request, env, origin);
			if (apiKeyError) return apiKeyError;

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
			if (path === "/api/v1/auth/refresh" && request.method === "POST") {
				return await (await import("./handlers/auth")).refresh(request, env);
			}
			if (path === "/api/v1/auth/logout" && request.method === "DELETE") {
				return await (await import("./handlers/auth")).logout(request, env);
			}
			if (path === "/api/v1/auth/me" && request.method === "GET") {
				return await (await import("./handlers/auth")).me(request, env);
			}

			// Authenticated routes (TODO: add auth middleware)
			if (path === "/api/v1/threads" && request.method === "POST") {
				return await (await import("./handlers/thread")).create(request, env);
			}
			if (path === "/api/v1/posts" && request.method === "POST") {
				return await (await import("./handlers/post")).create(request, env);
			}

			// ── Admin: Forums (Admin only) ────────────────────
			if (path === "/api/admin/forums" && request.method === "GET") {
				return await (await import("./handlers/admin/forum")).list(request, env);
			}
			if (path === "/api/admin/forums" && request.method === "POST") {
				return await (await import("./handlers/admin/forum")).create(request, env);
			}
			if (path.match(/^\/api\/admin\/forums\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/forum")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/forums\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/forum")).update(request, env);
			}
			if (path.match(/^\/api\/admin\/forums\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/forum")).remove(request, env);
			}

			// ── Admin: Threads (Moderator+) ───────────────────
			if (path === "/api/admin/threads" && request.method === "GET") {
				return await (await import("./handlers/admin/thread")).list(request, env);
			}
			if (path === "/api/admin/threads/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/thread")).batchDelete(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/thread")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/thread")).remove(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+\/sticky$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/thread")).setSticky(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+\/digest$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/thread")).setDigest(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+\/close$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/thread")).setClosed(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+\/move$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/thread")).move(request, env);
			}

			// ── Admin: Posts (Moderator+) ─────────────────────
			if (path === "/api/admin/posts" && request.method === "GET") {
				return await (await import("./handlers/admin/post")).list(request, env);
			}
			if (path === "/api/admin/posts/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/post")).batchDelete(request, env);
			}
			if (path.match(/^\/api\/admin\/posts\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/post")).remove(request, env);
			}

			// ── Admin: Users (Admin only) ─────────────────────
			if (path === "/api/admin/users" && request.method === "GET") {
				return await (await import("./handlers/admin/user")).list(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/user")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+\/status$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/user")).setStatus(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+\/role$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/user")).setRole(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+\/ban$/) && request.method === "POST") {
				return await (await import("./handlers/admin/user")).ban(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+\/nuke$/) && request.method === "POST") {
				return await (await import("./handlers/admin/user")).nuke(request, env);
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
