import { describe, expect, it, mock } from "bun:test";
import { getById, list, update } from "../../../src/handlers/forum";
import type { Env } from "../../../src/lib/env";

describe("forum handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
	};

	/** Full D1 row (snake_case) matching the real forums table */
	const makeD1ForumRow = (overrides?: Record<string, unknown>) => ({
		id: 1,
		parent_id: 0,
		name: "Test Forum",
		description: "A test forum",
		icon: "icon.png",
		display_order: 1,
		threads: 10,
		posts: 100,
		type: "forum",
		status: 0,
		last_thread_id: 42,
		last_post_at: 1711540800,
		last_poster: "alice",
		...overrides,
	});

	describe("list", () => {
		it("should map D1 snake_case rows to camelCase Forum objects", async () => {
			const d1Row = makeD1ForumRow();
			const db = {
				prepare: mock(() => ({
					all: mock(() => Promise.resolve({ results: [d1Row] })),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await list(new Request("https://example.com/api/v1/forums"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual([
				{
					id: 1,
					parentId: 0,
					name: "Test Forum",
					description: "A test forum",
					icon: "icon.png",
					displayOrder: 1,
					threads: 10,
					posts: 100,
					type: "forum",
					status: 0,
					lastThreadId: 42,
					lastPostAt: 1711540800,
					lastPoster: "alice",
				},
			]);
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});

		it("should call DB with correct query", async () => {
			const prepareSpy = mock(() => ({
				all: mock(() => Promise.resolve({ results: [] })),
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
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

		it("should include CORS headers with origin", async () => {
			const db = {
				prepare: mock(() => ({
					all: mock(() => Promise.resolve({ results: [] })),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await list(
				new Request("https://example.com/api/v1/forums", {
					headers: { Origin: "https://ellie.nocoo.cloud" },
				}),
				env,
			);

			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should return empty array when no forums exist", async () => {
			const db = {
				prepare: mock(() => ({
					all: mock(() => Promise.resolve({ results: [] })),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await list(new Request("https://example.com/api/v1/forums"), env);

			const data = await response.json();
			expect(data.data).toEqual([]);
		});
	});

	describe("getById", () => {
		it("should map D1 row to camelCase Forum when found", async () => {
			const d1Row = makeD1ForumRow({ id: 1 });
			const db = {
				prepare: mock(() => ({
					bind: mock(() => ({
						first: mock(() => Promise.resolve(d1Row)),
					})),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await getById(new Request("https://example.com/api/v1/forums/1"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.parentId).toBe(0);
			expect(data.data.displayOrder).toBe(1);
			expect(data.data.lastThreadId).toBe(42);
			expect(data.data.lastPostAt).toBe(1711540800);
			expect(data.data.lastPoster).toBe("alice");
			// Ensure no snake_case keys leak through
			expect(data.data.parent_id).toBeUndefined();
			expect(data.data.display_order).toBeUndefined();
		});

		it("should return 404 with CORS headers when forum not found", async () => {
			const db = {
				prepare: mock(() => ({
					bind: mock(() => ({
						first: mock(() => Promise.resolve(null)),
					})),
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const response = await getById(
				new Request("https://example.com/api/v1/forums/999", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				env,
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("FORUM_NOT_FOUND");
			// Error responses should include CORS headers
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should parse forum ID from URL", async () => {
			const d1Row = makeD1ForumRow({ id: 123 });
			const bindSpy = mock(() => ({
				first: mock(() => Promise.resolve(d1Row)),
			}));

			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
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

			expect(response.status).toBe(404);
		});
	});

	describe("update", () => {
		it("should return 501 NOT_IMPLEMENTED with CORS headers", async () => {
			const response = await update(
				new Request("https://example.com/api/admin/forums/1", {
					method: "PATCH",
					headers: { Origin: "http://localhost:3000" },
				}),
				mockEnv,
			);

			expect(response.status).toBe(501);
			const data = await response.json();
			expect(data.error.code).toBe("NOT_IMPLEMENTED");
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});
	});
});
