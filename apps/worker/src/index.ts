// Ellie API Worker — Cloudflare Worker with D1 + KV
// 66 endpoints: 17 public + 5 moderation + 44 admin
import type { CFRequest, Env } from "./lib/env";
import { validateApiKey } from "./middleware/apiKey";
import { corsHeaders } from "./middleware/cors";
import { errorResponse } from "./middleware/error";

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
			// ── #1 Health check (no auth, no cache) ──────────
			if (path === "/api/live" && request.method === "GET") {
				return await (await import("./handlers/live")).live(request, env);
			}

			// API Key gate — all routes below require a valid X-API-Key header
			const apiKeyError = validateApiKey(request, env, origin);
			if (apiKeyError) return apiKeyError;

			// ── Public routes (#2-#11) ───────────────────────
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
			if (path.match(/^\/api\/v1\/posts\/\d+\/attachments$/) && request.method === "GET") {
				return await (await import("./handlers/attachment")).listByPost(request, env);
			}
			if (path.match(/^\/api\/v1\/users\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/user")).getById(request, env);
			}

			// ── Auth routes (#12-#15) ────────────────────────
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

			// ── Authenticated routes (#6, #9) ────────────────
			if (path === "/api/v1/threads" && request.method === "POST") {
				return await (await import("./handlers/thread")).create(request, env);
			}
			if (path === "/api/v1/posts" && request.method === "POST") {
				return await (await import("./handlers/post")).create(request, env);
			}

			// ── User self-service (#16-#17) ──────────────────
			if (path === "/api/v1/users/me" && request.method === "PATCH") {
				return await (await import("./handlers/me")).updateProfile(request, env);
			}
			if (path === "/api/v1/users/me/password" && request.method === "POST") {
				return await (await import("./handlers/me")).changePassword(request, env);
			}

			// ── Moderation routes (Key A + JWT + role check) ─
			if (
				path.match(/^\/api\/v1\/moderation\/threads\/\d+\/sticky$/) &&
				request.method === "PATCH"
			) {
				return await (await import("./handlers/moderation")).setSticky(request, env);
			}
			if (
				path.match(/^\/api\/v1\/moderation\/threads\/\d+\/digest$/) &&
				request.method === "PATCH"
			) {
				return await (await import("./handlers/moderation")).setDigest(request, env);
			}
			if (
				path.match(/^\/api\/v1\/moderation\/threads\/\d+\/close$/) &&
				request.method === "PATCH"
			) {
				return await (await import("./handlers/moderation")).setClose(request, env);
			}
			if (path.match(/^\/api\/v1\/moderation\/threads\/\d+\/move$/) && request.method === "PATCH") {
				return await (await import("./handlers/moderation")).moveThread(request, env);
			}
			if (path.match(/^\/api\/v1\/moderation\/posts\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/moderation")).deletePost(request, env);
			}

			// ══════════════════════════════════════════════════
			// Admin endpoints (#18-#61)
			// All go through adminAuth via withEntityAuth wrapper
			// ══════════════════════════════════════════════════

			// ── A. Forum (Admin) #18-#24 ─────────────────────
			if (path === "/api/admin/forums/reorder" && request.method === "POST") {
				return await (await import("./handlers/admin/forum")).reorder(request, env);
			}
			if (path === "/api/admin/forums" && request.method === "GET") {
				return await (await import("./handlers/admin/forum")).list(request, env);
			}
			if (path === "/api/admin/forums" && request.method === "POST") {
				return await (await import("./handlers/admin/forum")).create(request, env);
			}
			if (path.match(/^\/api\/admin\/forums\/\d+\/merge$/) && request.method === "POST") {
				return await (await import("./handlers/admin/forum")).merge(request, env);
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

			// ── B. Thread (Mod+) #25-#30 ─────────────────────
			if (path === "/api/admin/threads/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/thread")).batchDelete(request, env);
			}
			if (path === "/api/admin/threads/batch-move" && request.method === "POST") {
				return await (await import("./handlers/admin/thread")).batchMove(request, env);
			}
			if (path === "/api/admin/threads" && request.method === "GET") {
				return await (await import("./handlers/admin/thread")).list(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/thread")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/thread")).update(request, env);
			}
			if (path.match(/^\/api\/admin\/threads\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/thread")).remove(request, env);
			}

			// ── C. Post (Mod+) #31-#35 ──────────────────────
			if (path === "/api/admin/posts/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/post")).batchDelete(request, env);
			}
			if (path === "/api/admin/posts" && request.method === "GET") {
				return await (await import("./handlers/admin/post")).list(request, env);
			}
			if (path.match(/^\/api\/admin\/posts\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/post")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/posts\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/post")).update(request, env);
			}
			if (path.match(/^\/api\/admin\/posts\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/post")).remove(request, env);
			}

			// ── D. User (Admin) #36-#42 ─────────────────────
			if (path === "/api/admin/users/batch-status" && request.method === "POST") {
				return await (await import("./handlers/admin/user")).batchStatus(request, env);
			}
			if (path === "/api/admin/users/batch-role" && request.method === "POST") {
				return await (await import("./handlers/admin/user")).batchRole(request, env);
			}
			if (path === "/api/admin/users" && request.method === "GET") {
				return await (await import("./handlers/admin/user")).list(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+\/ban$/) && request.method === "POST") {
				return await (await import("./handlers/admin/user")).ban(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+\/nuke$/) && request.method === "POST") {
				return await (await import("./handlers/admin/user")).nuke(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/user")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/users\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/user")).update(request, env);
			}

			// ── E. Attachment (Admin) #43-#46 ────────────────
			if (path === "/api/admin/attachments/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/attachment")).batchDelete(request, env);
			}
			if (path === "/api/admin/attachments" && request.method === "GET") {
				return await (await import("./handlers/admin/attachment")).list(request, env);
			}
			if (path.match(/^\/api\/admin\/attachments\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/attachment")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/attachments\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/attachment")).remove(request, env);
			}

			// ── F. IpBan (Admin) #47-#53 ────────────────────
			if (path === "/api/admin/ip-bans/check-ip" && request.method === "GET") {
				return await (await import("./handlers/admin/ipBan")).checkIp(request, env);
			}
			if (path === "/api/admin/ip-bans/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/ipBan")).batchDelete(request, env);
			}
			if (path === "/api/admin/ip-bans" && request.method === "GET") {
				return await (await import("./handlers/admin/ipBan")).list(request, env);
			}
			if (path === "/api/admin/ip-bans" && request.method === "POST") {
				return await (await import("./handlers/admin/ipBan")).create(request, env);
			}
			if (path.match(/^\/api\/admin\/ip-bans\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/ipBan")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/ip-bans\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/ipBan")).update(request, env);
			}
			if (path.match(/^\/api\/admin\/ip-bans\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/ipBan")).remove(request, env);
			}

			// ── G. CensorWord (Admin) #54-#60 ───────────────
			if (path === "/api/admin/censor-words/test" && request.method === "POST") {
				return await (await import("./handlers/admin/censorWord")).test(request, env);
			}
			if (path === "/api/admin/censor-words/batch-delete" && request.method === "POST") {
				return await (await import("./handlers/admin/censorWord")).batchDelete(request, env);
			}
			if (path === "/api/admin/censor-words" && request.method === "GET") {
				return await (await import("./handlers/admin/censorWord")).list(request, env);
			}
			if (path === "/api/admin/censor-words" && request.method === "POST") {
				return await (await import("./handlers/admin/censorWord")).create(request, env);
			}
			if (path.match(/^\/api\/admin\/censor-words\/\d+$/) && request.method === "GET") {
				return await (await import("./handlers/admin/censorWord")).getById(request, env);
			}
			if (path.match(/^\/api\/admin\/censor-words\/\d+$/) && request.method === "PATCH") {
				return await (await import("./handlers/admin/censorWord")).update(request, env);
			}
			if (path.match(/^\/api\/admin\/censor-words\/\d+$/) && request.method === "DELETE") {
				return await (await import("./handlers/admin/censorWord")).remove(request, env);
			}

			// ── H. Stats (Admin) #61 ────────────────────────
			if (path === "/api/admin/stats" && request.method === "GET") {
				return await (await import("./handlers/admin/stats")).handleStats(request, env);
			}

			// ── 404 — Not Found ─────────────────────────────
			return errorResponse("NOT_FOUND", 404, { path }, origin);
		} catch (err) {
			return errorResponse(
				"INTERNAL_ERROR",
				500,
				{ message: err instanceof Error ? err.message : String(err) },
				origin,
			);
		}
	},
};
