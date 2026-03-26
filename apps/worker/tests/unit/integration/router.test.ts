import { describe, expect, it, mock } from "bun:test";
import worker from "../../../src/index";
import type { CFRequest, Env } from "../../../src/lib/env";

/**
 * Route-level integration tests that call worker.fetch() directly,
 * proving the router dispatches to the correct handlers.
 */
describe("worker router integration", () => {
	/** Minimal mock env — handlers will hit mock DB */
	const makeEnv = (dbOverrides?: Partial<{ prepare: unknown }>): Env => ({
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
		RATE_LIMITER: {} as DurableObjectNamespace,
	});

	const makeRequest = (url: string, init?: RequestInit): CFRequest =>
		new Request(url, init) as CFRequest;

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
	});

	// ─── Forum Routes ─────────────────────────────────────

	describe("GET /api/v1/forums", () => {
		it("should route to forum list handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums"),
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
				makeRequest("https://api.example.com/api/v1/forums/1"),
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
				makeRequest("https://api.example.com/api/v1/threads?forumId=1"),
				makeEnv(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toBeArray();
		});

		it("should return 400 without forumId", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads"),
				makeEnv(),
			);

			expect(response.status).toBe(400);
		});
	});

	describe("GET /api/v1/threads/:id", () => {
		it("should route to thread getById handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads/1"),
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
				makeRequest("https://api.example.com/api/v1/posts?threadId=1"),
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
				makeRequest("https://api.example.com/api/v1/posts/1"),
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
				makeRequest("https://api.example.com/api/v1/users/1"),
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
				makeRequest("https://api.example.com/api/v1/auth/login", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						username: "test",
						password: "test",
					}),
				}),
				makeEnv(),
			);

			// Should reach the handler (401 because user not found in mock DB)
			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("should NOT match GET /api/v1/auth/login", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/auth/login"),
				makeEnv(),
			);

			expect(response.status).toBe(404);
		});
	});

	// ─── Stub Routes ──────────────────────────────────────

	describe("POST /api/v1/threads (stub)", () => {
		it("should route to thread create handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/threads", { method: "POST" }),
				makeEnv(),
			);

			expect(response.status).toBe(501);
		});
	});

	describe("POST /api/v1/posts (stub)", () => {
		it("should route to post create handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/posts", { method: "POST" }),
				makeEnv(),
			);

			expect(response.status).toBe(501);
		});
	});

	describe("PATCH /api/admin/forums/:id (stub)", () => {
		it("should route to forum update handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/admin/forums/1", { method: "PATCH" }),
				makeEnv(),
			);

			expect(response.status).toBe(501);
		});
	});

	describe("DELETE /api/admin/users/:id (stub)", () => {
		it("should route to user delete handler", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/admin/users/1", { method: "DELETE" }),
				makeEnv(),
			);

			expect(response.status).toBe(501);
		});
	});

	// ─── 404 Fallback ─────────────────────────────────────

	describe("unknown routes", () => {
		it("should return 404 with CORS headers for unknown paths", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/unknown", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				makeEnv(),
			);

			expect(response.status).toBe(404);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should return 404 for wrong HTTP method", async () => {
			const response = await worker.fetch(
				makeRequest("https://api.example.com/api/v1/forums", { method: "DELETE" }),
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
				makeRequest("https://api.example.com/api/v1/forums", {
					headers: {
						Origin: "http://localhost:3000",
					},
				}),
				env,
			);

			expect(response.status).toBe(500);
			const data = await response.json();
			expect(data.error).toBe("Internal server error");
			expect(data.message).toBe("DB exploded");
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});
	});
});
