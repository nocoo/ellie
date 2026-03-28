import { describe, expect, it, mock } from "bun:test";
import worker from "../../../src/index";
import type { CFRequest, Env } from "../../../src/lib/env";

/**
 * Route-level integration tests that call worker.fetch() directly,
 * proving the router dispatches to the correct handlers.
 */
describe("worker router integration", () => {
	const TEST_API_KEY = "test-api-key";
	const TEST_ADMIN_API_KEY = "test-admin-api-key";

	/** Minimal mock env — handlers will hit mock DB */
	const makeEnv = (dbOverrides?: Partial<{ prepare: unknown }>): Env => ({
		API_KEY: TEST_API_KEY,
		ADMIN_API_KEY: TEST_ADMIN_API_KEY,
		DB: {
			prepare: mock(() => ({
				all: mock(() => Promise.resolve({ results: [] })),
				bind: mock(() => ({
					first: mock(() => Promise.resolve(null)),
					all: mock(() => Promise.resolve({ results: [] })),
					run: mock(() => Promise.resolve()),
				})),
				first: mock(() => Promise.resolve(null)),
			})),
			...dbOverrides,
		} as unknown as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {
			put: mock(() => Promise.resolve()),
		} as unknown as KVNamespace,
	});

	const makeRequest = (url: string, init?: RequestInit): CFRequest =>
		new Request(url, init) as CFRequest;

	/** Shorthand: inject X-API-Key header (Key A) into init */
	const withApiKey = (init?: RequestInit): RequestInit => ({
		...init,
		headers: {
			...(init?.headers ?? {}),
			"X-API-Key": TEST_API_KEY,
		},
	});

	/** Shorthand: inject X-API-Key header (Key B) for admin routes */
	const _withAdminKey = (init?: RequestInit): RequestInit => ({
		...init,
		headers: {
			...(init?.headers ?? {}),
			"X-API-Key": TEST_ADMIN_API_KEY,
		},
	});

	// ─── API Key Gate ─────────────────────────────────────

	describe("API Key validation", () => {
		it("should return 401 without X-API-Key header", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums"),
				makeEnv(),
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("UNAUTHORIZED");
		});

		it("should return 401 with wrong X-API-Key", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", {
					headers: { "X-API-Key": "wrong-key" },
				}),
				makeEnv(),
			);

			expect(response.status).toBe(401);
		});

		it("should include CORS headers on 401 response", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", {
					headers: { Origin: "https://ellie.nocoo.cloud" },
				}),
				makeEnv(),
			);

			expect(response.status).toBe(401);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should NOT require API key for GET /api/live", async () => {
			const env = makeEnv({
				prepare: mock(() => ({
					first: mock(() => Promise.resolve({ probe: 1 })),
				})),
			});

			const response = await worker.fetch(makeRequest("https://api.example.com/api/live"), env);

			expect(response.status).toBe(200);
		});

		it("should NOT require API key for OPTIONS preflight", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", {
					method: "OPTIONS",
					headers: { Origin: "https://ellie.nocoo.cloud" },
				}),
				makeEnv(),
			);

			expect(response.status).toBe(204);
		});

		it("should pass with valid X-API-Key", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(200);
		});
	});

	// ─── CORS Preflight ───────────────────────────────────

	describe("CORS preflight", () => {
		it("should respond 204 to OPTIONS with origin", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", {
					method: "OPTIONS",
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				makeEnv(),
			);

			expect(response.status).toBe(204);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
			expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-API-Key");
		});

		it("should not set Allow-Origin for disallowed origin", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", {
					method: "OPTIONS",
					headers: { Origin: "https://evil.com" },
				}),
				makeEnv(),
			);

			expect(response.status).toBe(204);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
		});
	});

	// ─── Health Check ─────────────────────────────────────

	describe("GET /api/live", () => {
		it("should return health check response", async () => {
			const env = makeEnv({
				prepare: mock(() => ({
					first: mock(() => Promise.resolve({ probe: 1 })),
				})),
			});

			const response = await worker.fetch(makeRequest("https://api.example.com/api/live"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.status).toBe("ok");
		});

		it("should include Access-Control-Allow-Origin for allowed origin", async () => {
			const env = makeEnv({
				prepare: mock(() => ({
					first: mock(() => Promise.resolve({ probe: 1 })),
				})),
			});

			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/live", {
					headers: { Origin: "https://ellie.nocoo.cloud" },
				}),
				env,
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});
	});

	// ─── Forum Routes ─────────────────────────────────────

	describe("GET /api/v1/forums", () => {
		it("should route to forum list handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toBeArray();
		});
	});

	describe("GET /api/v1/forums/:id", () => {
		it("should route to forum getById handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums/1", withApiKey()),
				makeEnv(),
			);

			// 404 because mock returns null
			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("FORUM_NOT_FOUND");
		});
	});

	// ─── Thread Routes ────────────────────────────────────

	describe("GET /api/v1/threads", () => {
		it("should route to thread list handler (requires forumId)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads?forumId=1", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toBeArray();
		});

		it("should return 400 without forumId", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(400);
		});
	});

	describe("GET /api/v1/threads/:id", () => {
		it("should route to thread getById handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads/1", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("THREAD_NOT_FOUND");
		});
	});

	// ─── Post Routes ──────────────────────────────────────

	describe("GET /api/v1/posts", () => {
		it("should route to post list handler (requires threadId)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/posts?threadId=1", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toBeArray();
		});
	});

	describe("GET /api/v1/posts/:id", () => {
		it("should route to post getById handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/posts/1", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});
	});

	// ─── User Routes ──────────────────────────────────────

	describe("GET /api/v1/users/:id", () => {
		it("should route to user getById handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/users/1", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
		});
	});

	// ─── Auth Routes ──────────────────────────────────────

	describe("POST /api/v1/auth/login", () => {
		it("should route to auth login handler", async () => {
			const response = await worker.fetch(
				makeRequest(
					"https://api.example.com/api/v1/auth/login",
					withApiKey({
						method: "POST",
						headers: {
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							username: "test",
							password: "test",
						}),
					}),
				),
				makeEnv(),
			);

			// Should reach the handler (401 because user not found in mock DB)
			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("should NOT match GET /api/v1/auth/login", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/auth/login", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(404);
		});
	});

	// ─── Admin Routes ────────────────────────────────────
	// Admin routes use Key B (ADMIN_API_KEY) — Key A is rejected at the apiKey gate.
	// Admin endpoints only require Key B (no JWT needed).

	describe("Admin Forum routes", () => {
		it("GET /api/admin/forums should reject Key A (401)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/admin/forums", withApiKey()),
				makeEnv(),
			);
			expect(response.status).toBe(401);
		});
	});

	// ─── 404 Fallback ─────────────────────────────────────

	describe("unknown routes", () => {
		it("should return 404 with CORS headers for unknown paths", async () => {
			const response = await worker.fetch(
				makeRequest(
					"https://api.example.com/api/v1/unknown",
					withApiKey({
						headers: {
							Origin: "https://ellie.nocoo.cloud",
						},
					}),
				),
				makeEnv(),
			);

			expect(response.status).toBe(404);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should return 404 for wrong HTTP method", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", withApiKey({ method: "DELETE" })),
				makeEnv(),
			);

			expect(response.status).toBe(404);
		});
	});

	// ─── Error Handling ───────────────────────────────────

	describe("500 error handling", () => {
		it("should return 500 with CORS headers when handler throws", async () => {
			const throwAsync = async () => {
				throw new Error("DB exploded");
			};
			const env = makeEnv({
				prepare: mock(() => ({
					all: mock(throwAsync),
					bind: mock(() => ({
						first: mock(throwAsync),
						all: mock(throwAsync),
					})),
				})),
			});

			const response = await worker.fetch(
				makeRequest(
					"https://api.example.com/api/v1/forums",
					withApiKey({
						headers: {
							Origin: "http://localhost:3000",
						},
					}),
				),
				env,
			);

			expect(response.status).toBe(500);
			const data = await response.json();
			expect(data.error.code).toBe("INTERNAL_ERROR");
			expect(data.error.message).toBe("Internal server error");
			expect(data.error.details.message).toBe("DB exploded");
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});
	});

	// ─── Uncovered Route Dispatches ──────────────────────

	describe("Auth routes (refresh, logout, me)", () => {
		it("POST /api/v1/auth/refresh should reach handler", async () => {
			const response = await worker.fetch(
				makeRequest(
					"https://api.example.com/api/v1/auth/refresh",
					withApiKey({
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({}),
					}),
				),
				makeEnv(),
			);

			// Handler will reject due to missing/invalid refresh token
			expect([400, 401]).toContain(response.status);
		});

		it("DELETE /api/v1/auth/logout should reach handler", async () => {
			const env = makeEnv();
			// Add KV.delete for logout handler
			(env.KV as unknown as Record<string, unknown>).delete = mock(() => Promise.resolve());

			const response = await worker.fetch(
				makeRequest(
					"https://api.example.com/api/v1/auth/logout",
					withApiKey({
						method: "DELETE",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ refreshToken: "some-token" }),
					}),
				),
				env,
			);

			// Handler succeeds (KV.delete is fire-and-forget)
			expect(response.status).toBe(200);
		});

		it("GET /api/v1/auth/me should require auth (401)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/auth/me", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(401);
		});
	});

	describe("Authenticated write routes", () => {
		it("POST /api/v1/threads should require auth (401)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads", withApiKey({ method: "POST" })),
				makeEnv(),
			);

			expect(response.status).toBe(401);
		});

		it("POST /api/v1/posts should require auth (401)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/posts", withApiKey({ method: "POST" })),
				makeEnv(),
			);

			expect(response.status).toBe(401);
		});
	});

	describe("User self-service routes", () => {
		it("PATCH /api/v1/users/me should require auth (401)", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/users/me", withApiKey({ method: "PATCH" })),
				makeEnv(),
			);

			expect(response.status).toBe(401);
		});

		it("POST /api/v1/users/me/password should require auth (401)", async () => {
			const response = await worker.fetch(
				makeRequest(
					"https://api.example.com/api/v1/users/me/password",
					withApiKey({ method: "POST" }),
				),
				makeEnv(),
			);

			expect(response.status).toBe(401);
		});
	});

	describe("Attachment routes", () => {
		it("GET /api/v1/posts/:id/attachments should route to handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/posts/1/attachments", withApiKey()),
				makeEnv(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toBeArray();
		});
	});
});
