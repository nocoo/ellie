import { describe, expect, it, mock } from "bun:test";
import { getById, list } from "../../../src/handlers/forum";
import type { Env } from "../../../src/lib/env";
import { createMockCtx, createMockKV } from "../../helpers";

describe("forum handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		ADMIN_API_KEY: "test-admin-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: createMockKV(),
	};

	const mockCtx = createMockCtx();

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
		moderators: "",
		last_thread_id: 42,
		last_post_at: 1711540800,
		last_poster: "alice",
		last_poster_id: 10,
		last_thread_subject: "Latest Thread",
		...overrides,
	});

	describe("list", () => {
		/** Helper: creates a mock DB where prepare() returns different results based on SQL */
		function createListMockDb(forumRows: unknown[], countRows: unknown[] = []) {
			return {
				prepare: mock((sql: string) => {
					if (sql.includes("SELECT * FROM forums")) {
						return {
							all: mock(() => Promise.resolve({ results: forumRows })),
						};
					}
					// Thread count query
					return {
						bind: mock(() => ({
							all: mock(() => Promise.resolve({ results: countRows })),
						})),
					};
				}),
			} as unknown as D1Database;
		}

		it("should map D1 snake_case rows to camelCase Forum objects", async () => {
			const d1Row = makeD1ForumRow();
			const db = createListMockDb([d1Row], [{ forum_id: 1, cnt: 3 }]);

			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await list(new Request("https://example.com/api/v1/forums"), env, ctx);

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
					moderators: "",
					todayThreads: 3,
					lastThreadId: 42,
					lastPostAt: 1711540800,
					lastPoster: "alice",
					lastPosterId: 10,
					lastPosterAvatar: "",
					lastThreadSubject: "Latest Thread",
				},
			]);
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});

		it("should set todayThreads to 0 when no recent threads", async () => {
			const d1Row = makeD1ForumRow({ id: 5 });
			const db = createListMockDb([d1Row], []);

			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await list(new Request("https://example.com/api/v1/forums"), env, ctx);

			const data = await response.json();
			expect(data.data[0].todayThreads).toBe(0);
		});

		it("should call DB with correct forum query", async () => {
			const db = createListMockDb([]);
			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			await list(new Request("https://example.com/api/v1/forums"), env, ctx);

			expect(db.prepare).toHaveBeenCalledWith("SELECT * FROM forums ORDER BY display_order");
		});

		it("should return JSON content type", async () => {
			const db = createListMockDb([]);
			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await list(new Request("https://example.com/api/v1/forums"), env, ctx);

			expect(response.headers.get("Content-Type")).toBe("application/json");
		});

		it("should include CORS headers with origin", async () => {
			const db = createListMockDb([]);
			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await list(
				new Request("https://example.com/api/v1/forums", {
					headers: { Origin: "https://ellie.nocoo.cloud" },
				}),
				env,
				ctx,
			);

			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should return empty array when no forums exist", async () => {
			const db = createListMockDb([]);
			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await list(new Request("https://example.com/api/v1/forums"), env, ctx);

			const data = await response.json();
			expect(data.data).toEqual([]);
		});
	});

	describe("getById", () => {
		/** Helper: creates a mock DB for getById which has multiple prepare() calls */
		function createGetByIdMockDb(forumRow: unknown | null, todayCount = 0) {
			return {
				prepare: mock((sql: string) => {
					if (sql.includes("SELECT * FROM forums WHERE id")) {
						return {
							bind: mock(() => ({
								first: mock(() => Promise.resolve(forumRow)),
							})),
						};
					}
					// User cache query
					if (sql.includes("SELECT id, username, avatar")) {
						return {
							bind: mock(() => ({
								all: mock(() => Promise.resolve({ results: [] })),
							})),
						};
					}
					// Thread count query
					return {
						bind: mock(() => ({
							first: mock(() => Promise.resolve({ cnt: todayCount })),
						})),
					};
				}),
			} as unknown as D1Database;
		}

		it("should map D1 row to camelCase Forum when found", async () => {
			const d1Row = makeD1ForumRow({ id: 1 });
			const db = createGetByIdMockDb(d1Row, 7);

			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await getById(new Request("https://example.com/api/v1/forums/1"), env, ctx);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.parentId).toBe(0);
			expect(data.data.displayOrder).toBe(1);
			expect(data.data.lastThreadId).toBe(42);
			expect(data.data.lastPostAt).toBe(1711540800);
			expect(data.data.lastPoster).toBe("alice");
			expect(data.data.todayThreads).toBe(7);
			// Ensure no snake_case keys leak through
			expect(data.data.parent_id).toBeUndefined();
			expect(data.data.display_order).toBeUndefined();
		});

		it("should return 404 with CORS headers when forum not found", async () => {
			const db = createGetByIdMockDb(null);

			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await getById(
				new Request("https://example.com/api/v1/forums/999", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				env,
				ctx,
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
				prepare: mock((sql: string) => {
					if (sql.includes("SELECT * FROM forums WHERE id")) {
						return { bind: bindSpy };
					}
					// User cache query
					if (sql.includes("SELECT id, username, avatar")) {
						return {
							bind: mock(() => ({
								all: mock(() => Promise.resolve({ results: [] })),
							})),
						};
					}
					return {
						bind: mock(() => ({
							first: mock(() => Promise.resolve({ cnt: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			await getById(new Request("https://example.com/api/v1/forums/123"), env, ctx);

			expect(bindSpy).toHaveBeenCalledWith(123);
		});

		it("should handle non-numeric ID gracefully", async () => {
			const db = createGetByIdMockDb(null);

			const env = { ...mockEnv, DB: db };
			const ctx = createMockCtx();
			const response = await getById(new Request("https://example.com/api/v1/forums/abc"), env, ctx);

			expect(response.status).toBe(404);
		});
	});
});
