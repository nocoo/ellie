import { describe, expect, it, mock } from "bun:test";
import { create, getById, list } from "../../../src/handlers/post";
import type { Env } from "../../../src/lib/env";
import {
	TEST_JWT_SECRET,
	createJwtForRole,
	createMockDb,
	createMockKV,
	makeD1PostRow,
	makeD1ThreadRow,
} from "../../helpers";

describe("post handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
	};

	describe("list", () => {
		it("should require threadId parameter", async () => {
			const response = await list(new Request("https://example.com/api/v1/posts"), mockEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should reject invalid threadId", async () => {
			const response = await list(
				new Request("https://example.com/api/v1/posts?threadId=abc"),
				mockEnv,
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should clamp limit to [1, 100]", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Test limit > 100
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=200"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 100);

			// Test limit within range
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=100"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 100);

			// Test limit < 1
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=0"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 100); // default
		});

		it("should map D1 snake_case rows to camelCase Post objects", async () => {
			const d1Row = makeD1PostRow({ thread_id: 10, forum_id: 5, author_id: 100 });
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(new Request("https://example.com/api/v1/posts?threadId=10"), env);

			const data = await response.json();
			const post = data.data[0];
			// Verify camelCase mapping
			expect(post.threadId).toBe(10);
			expect(post.forumId).toBe(5);
			expect(post.authorId).toBe(100);
			expect(post.authorName).toBe("alice");
			expect(post.createdAt).toBe(1711540800);
			// Verify is_first INTEGER → boolean conversion
			expect(post.isFirst).toBe(true);
			// No snake_case leaks
			expect(post.thread_id).toBeUndefined();
			expect(post.author_id).toBeUndefined();
			expect(post.is_first).toBeUndefined();
		});

		it("should convert is_first 0 to false", async () => {
			const d1Row = makeD1PostRow({ is_first: 0 });
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(new Request("https://example.com/api/v1/posts?threadId=10"), env);

			const data = await response.json();
			expect(data.data[0].isFirst).toBe(false);
		});

		it("should query posts without cursor on first page", async () => {
			const d1Row = makeD1PostRow();
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/posts?threadId=1"), env);

			expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining("ORDER BY position"));
			expect(bindSpy).toHaveBeenCalledWith(1, 100);
		});

		it("should decode and use cursor for pagination", async () => {
			const cursor = btoa(JSON.stringify({ position: 100 }));
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(
				new Request(
					`https://example.com/api/v1/posts?threadId=1&cursor=${encodeURIComponent(cursor)}`,
				),
				env,
			);

			expect(bindSpy).toHaveBeenCalledWith(
				1, // threadId
				100, // position
				100, // limit
			);
		});

		it("should generate valid next cursor that roundtrips correctly", async () => {
			const posts = Array.from({ length: 100 }, (_, i) =>
				makeD1PostRow({ id: i + 1, position: i + 1 }),
			);

			const allSpy = mock(() => Promise.resolve({ results: posts }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/posts?threadId=1&limit=100"),
				env,
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeDefined();

			// Decode and verify cursor roundtrip
			const decoded = JSON.parse(atob(data.meta.nextCursor));
			expect(decoded.position).toBe(100);
		});

		it("should not generate next cursor when results are less than limit", async () => {
			const d1Row = makeD1PostRow();
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/posts?threadId=1&limit=20"),
				env,
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeNull();
		});

		it("should handle invalid cursor gracefully", async () => {
			const invalidCursor = btoa(JSON.stringify({ wrong: "structure" }));
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(
				new Request(
					`https://example.com/api/v1/posts?threadId=1&cursor=${encodeURIComponent(invalidCursor)}`,
				),
				env,
			);

			// Should fall back to first page query
			expect(prepareSpy).toHaveBeenCalledWith(expect.not.stringContaining("position >"));
		});

		it("should handle malformed cursor (invalid base64)", async () => {
			const malformedCursor = "not-valid-base64!!!";
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(
				new Request(
					`https://example.com/api/v1/posts?threadId=1&cursor=${encodeURIComponent(malformedCursor)}`,
				),
				env,
			);

			// Should fall back to first page query
			expect(prepareSpy).toHaveBeenCalledWith(expect.not.stringContaining("position >"));
		});

		it("should not generate next cursor when results are empty", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(new Request("https://example.com/api/v1/posts?threadId=1"), env);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeNull();
			expect(data.data).toEqual([]);
		});

		it("should use valid limit within range", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=10"), env);

			expect(bindSpy).toHaveBeenCalledWith(1, 10);
		});

		it("should include CORS headers with origin", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/posts?threadId=1", {
					headers: {
						Origin: "http://localhost:3000",
					},
				}),
				env,
			);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});
	});

	describe("getById", () => {
		it("should map D1 row to camelCase Post when found", async () => {
			const d1Row = makeD1PostRow({ id: 123, thread_id: 10, forum_id: 5, is_first: 0 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/posts/123"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.id).toBe(123);
			expect(data.data.threadId).toBe(10);
			expect(data.data.forumId).toBe(5);
			expect(data.data.isFirst).toBe(false);
			// No snake_case leaks
			expect(data.data.thread_id).toBeUndefined();
			expect(data.data.is_first).toBeUndefined();
		});

		it("should return 404 when post not found", async () => {
			const firstSpy = mock(() => Promise.resolve(null));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/posts/999"), env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should parse post ID from URL", async () => {
			const d1Row = makeD1PostRow({ id: 456 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/posts/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});
	});

	describe("create", () => {
		it("should require authentication", async () => {
			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
				}),
				mockEnv,
			);

			expect(response.status).toBe(401);
		});

		it("should validate required fields", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, forum_id, closed FROM threads WHERE id": makeD1ThreadRow({
						id: 1,
						closed: 0,
					}),
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1 }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should require valid threadId", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: "invalid", content: "Test" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should reject non-existent thread", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id, forum_id, closed FROM threads WHERE id": null },
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 999, content: "Test reply" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject reply to closed thread", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, forum_id, closed FROM threads WHERE id": { id: 1, forum_id: 10, closed: 1 },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "Test reply" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(403);
			const body = await response.json();
			expect(body.error.code).toBe("THREAD_CLOSED");
		});

		it("should create reply and update counts", async () => {
			const token = await createJwtForRole(0, 42);
			const createdPost = makeD1PostRow({
				id: 50,
				thread_id: 1,
				forum_id: 10,
				position: 6,
				is_first: 0,
			});
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id, forum_id, closed FROM threads WHERE id": { id: 1, forum_id: 10, closed: 0 },
					"SELECT MAX(position)": { maxPos: 5 },
					"SELECT * FROM posts WHERE id": createdPost,
				},
				runResults: {
					"INSERT INTO posts": { success: true, meta: { last_row_id: 50 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "<p>My reply</p>" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.id).toBe(50);

			// Verify batch was called: UPDATE threads + UPDATE forums + UPDATE users = 3
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(3);
		});

		it("should trim content", async () => {
			const token = await createJwtForRole(0, 42);
			const createdPost = makeD1PostRow({ id: 50, content: "Trimmed" });
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, forum_id, closed FROM threads WHERE id": { id: 1, forum_id: 10, closed: 0 },
					"SELECT MAX(position)": { maxPos: 1 },
					"SELECT * FROM posts WHERE id": createdPost,
				},
				runResults: {
					"INSERT INTO posts": { success: true, meta: { last_row_id: 50 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "  Trimmed  " }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
		});

		it("should reject empty content after trimming", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, forum_id, closed FROM threads WHERE id": { id: 1, forum_id: 10, closed: 0 },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ threadId: 1, content: "   " }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("content is required");
		});

		it("should handle malformed JSON", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({});

			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: "invalid json",
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});
	});
});
