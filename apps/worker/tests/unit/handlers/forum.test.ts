import { describe, expect, it, mock } from "bun:test";
import { getById, list } from "../../../src/handlers/forum";
import type { Env } from "../../../src/lib/env";

describe("forum handlers", () => {
	const mockDb = {
		prepare: mock(() => ({
			all: mock(() => Promise.resolve({ results: [] })),
			bind: mock(() => ({
				first: mock(() => Promise.resolve(null)),
			})),
		})),
	} as unknown as D1Database;

	const mockEnv: Env = {
		DB: mockDb,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
		RATE_LIMITER: {} as DurableObjectNamespace,
	};

	describe("list", () => {
		it("should return forums array", async () => {
			const forums = [{ id: 1, name: "Test Forum", display_order: 1 }];
			const db = {
				prepare: mock(() => ({
					all: mock(() => Promise.resolve({ results: forums })),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await list(new Request("https://example.com/api/v1/forums"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual(forums);
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});

		it("should call DB with correct query", async () => {
			const prepareSpy = mock(() => ({
				all: mock(() => Promise.resolve({ results: [] })),
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			await list(new Request("https://example.com/api/v1/forums"), env);

			expect(prepareSpy).toHaveBeenCalledWith("SELECT * FROM forums ORDER BY display_order");
		});

		it("should return JSON content type", async () => {
			const db = {
				prepare: mock(() => ({
					all: mock(() => Promise.resolve({ results: [] })),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await list(new Request("https://example.com/api/v1/forums"), env);

			expect(response.headers.get("Content-Type")).toBe("application/json");
		});

		it("should include CORS headers", async () => {
			const db = {
				prepare: mock(() => ({
					all: mock(() => Promise.resolve({ results: [] })),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await list(new Request("https://example.com/api/v1/forums"), env);

			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		});
	});

	describe("getById", () => {
		it("should return forum when found", async () => {
			const forum = { id: 1, name: "Test Forum" };
			const db = {
				prepare: mock(() => ({
					bind: mock(() => ({
						first: mock(() => Promise.resolve(forum)),
					})),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await getById(new Request("https://example.com/api/v1/forums/1"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual(forum);
		});

		it("should return 404 when forum not found", async () => {
			const db = {
				prepare: mock(() => ({
					bind: mock(() => ({
						first: mock(() => Promise.resolve(null)),
					})),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await getById(new Request("https://example.com/api/v1/forums/999"), env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error).toBeDefined();
			expect(data.error.code).toBe("FORUM_NOT_FOUND");
		});

		it("should parse forum ID from URL", async () => {
			const forum = { id: 123, name: "Test Forum" };
			const bindSpy = mock(() => ({
				first: mock(() => Promise.resolve(forum)),
			}));

			const db = {
				prepare: mock(() => ({
					bind: bindSpy,
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			await getById(new Request("https://example.com/api/v1/forums/123"), env);

			expect(bindSpy).toHaveBeenCalledWith(123);
		});

		it("should handle non-numeric ID gracefully", async () => {
			const db = {
				prepare: mock(() => ({
					bind: mock(() => ({
						first: mock(() => Promise.resolve(null)),
					})),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await getById(new Request("https://example.com/api/v1/forums/abc"), env);

			// NaN should result in not found
			expect(response.status).toBe(404);
		});
	});
});
