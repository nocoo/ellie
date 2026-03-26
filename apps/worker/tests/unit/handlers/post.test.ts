import { describe, expect, it, mock } from "bun:test";
import { create, getById, list } from "../../../src/handlers/post";
import type { Env } from "../../../src/lib/env";

describe("post handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
	};

	/** Full D1 row (snake_case) matching the real posts table */
	const makeD1PostRow = (overrides?: Record<string, unknown>) => ({
		id: 1,
		thread_id: 10,
		forum_id: 5,
		author_id: 100,
		author_name: "alice",
		content: "Hello world",
		created_at: 1711540800,
		is_first: 1,
		position: 1,
		...overrides,
	});

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

		it("should clamp limit to [1, 50]", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Test limit > 50
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=100"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 50);

			// Test limit < 1
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=0"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 20); // default
		});

		it("should map D1 snake_case rows to camelCase Post objects", async () => {
			const d1Row = makeD1PostRow();
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
			expect(bindSpy).toHaveBeenCalledWith(1, 20);
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
				20, // limit
			);
		});

		it("should generate valid next cursor that roundtrips correctly", async () => {
			const posts = Array.from({ length: 20 }, (_, i) =>
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
				new Request("https://example.com/api/v1/posts?threadId=1&limit=20"),
				env,
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeDefined();

			// Decode and verify cursor roundtrip
			const decoded = JSON.parse(atob(data.meta.nextCursor));
			expect(decoded.position).toBe(20);
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
			expect(data.meta.nextCursor).toBeUndefined();
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
			expect(data.meta.nextCursor).toBeUndefined();
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
			const d1Row = makeD1PostRow({ id: 123, is_first: 0 });
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
		it("should return 501 NOT_IMPLEMENTED", async () => {
			const response = await create(
				new Request("https://example.com/api/v1/posts", {
					method: "POST",
				}),
				mockEnv,
			);

			expect(response.status).toBe(501);
			const data = await response.json();
			expect(data.error.code).toBe("NOT_IMPLEMENTED");
		});
	});
});
