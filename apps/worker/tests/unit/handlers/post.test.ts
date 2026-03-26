import { describe, expect, it, mock } from "bun:test";
import { create, getById, list } from "../../../src/handlers/post";
import type { Env } from "../../../src/lib/env";

describe("post handlers", () => {
	const mockEnv: Env = {
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
		RATE_LIMITER: {} as DurableObjectNamespace,
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

		it("should clamp limit to [1, 50]", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));

			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			// Test limit > 50
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=100"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 50);

			// Test limit < 1
			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=0"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 20); // default
		});

		it("should query posts without cursor on first page", async () => {
			const posts = [{ id: 1, position: 1 }];

			const allSpy = mock(() => Promise.resolve({ results: posts }));

			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

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

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			await list(
				new Request(
					`https://example.com/api/v1/posts?threadId=1&cursor=${encodeURIComponent(cursor)}`,
				),
				env,
			);

			// Should call bind with cursor values
			expect(bindSpy).toHaveBeenCalledWith(
				1, // threadId
				100, // position
				20, // limit
			);
		});

		it("should generate next cursor when results fill the page", async () => {
			const posts = Array.from({ length: 20 }, (_, i) => ({
				id: i + 1,
				position: i + 1,
			}));

			const allSpy = mock(() => Promise.resolve({ results: posts }));

			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));

			const db = {
				prepare: mock(() => ({
					bind: bindSpy,
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/posts?threadId=1&limit=20"),
				env,
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeDefined();
		});

		it("should not generate next cursor when results are less than limit", async () => {
			const posts = [{ id: 1, position: 1 }];

			const allSpy = mock(() => Promise.resolve({ results: posts }));

			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));

			const db = {
				prepare: mock(() => ({
					bind: bindSpy,
				})),
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
			// Invalid cursor - valid JSON but wrong structure
			const invalidCursor = btoa(JSON.stringify({ wrong: "structure" }));

			const allSpy = mock(() => Promise.resolve({ results: [] }));

			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const _response = await list(
				new Request(
					`https://example.com/api/v1/posts?threadId=1&cursor=${encodeURIComponent(invalidCursor)}`,
				),
				env,
			);

			// Should fall back to first page query
			expect(prepareSpy).toHaveBeenCalledWith(expect.not.stringContaining("position >"));
		});

		it("should handle malformed cursor (invalid base64)", async () => {
			// Completely invalid cursor
			const malformedCursor = "not-valid-base64!!!";

			const allSpy = mock(() => Promise.resolve({ results: [] }));

			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const _response = await list(
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
				prepare: mock(() => ({
					bind: bindSpy,
				})),
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
				prepare: mock(() => ({
					bind: bindSpy,
				})),
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/posts?threadId=1&limit=10"), env);

			expect(bindSpy).toHaveBeenCalledWith(1, 10);
		});
	});

	describe("getById", () => {
		it("should return post when found", async () => {
			const post = { id: 123, content: "Test post" };

			const firstSpy = mock(() => Promise.resolve(post));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/posts/123"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual(post);
		});

		it("should return 404 when post not found", async () => {
			const firstSpy = mock(() => Promise.resolve(null));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/posts/999"), env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});

		it("should parse post ID from URL", async () => {
			const firstSpy = mock(() => Promise.resolve({ id: 456 }));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/posts/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});
	});

	describe("create", () => {
		it("should return 501 NOT_IMPLEMENTED", async () => {
			const response = await create(
				new Request("https://example.com/api/v1/posts", { method: "POST" }),
				mockEnv,
			);

			expect(response.status).toBe(501);
			const data = await response.json();
			expect(data.error.code).toBe("NOT_IMPLEMENTED");
		});
	});
});
