import { describe, expect, it, mock } from "bun:test";
import { create, getById, list } from "../../../src/handlers/thread";
import type { Env } from "../../../src/lib/env";
import {
	TEST_JWT_SECRET,
	createJwtForRole,
	createMockDb,
	makeD1ForumRow,
	makeD1ThreadRow,
} from "../../helpers";

describe("thread handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: {} as KVNamespace,
	};

	describe("list", () => {
		it("should require forumId parameter", async () => {
			const response = await list(new Request("https://example.com/api/v1/threads"), mockEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should reject invalid forumId", async () => {
			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=abc"),
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
			await list(new Request("https://example.com/api/v1/threads?forumId=1&limit=200"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 100);

			// Test limit within range
			await list(new Request("https://example.com/api/v1/threads?forumId=1&limit=100"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 100);

			// Test limit < 1
			await list(new Request("https://example.com/api/v1/threads?forumId=1&limit=0"), env);
			expect(bindSpy).toHaveBeenLastCalledWith(expect.any(Number), 100); // default
		});

		it("should map D1 snake_case rows to camelCase Thread objects", async () => {
			const d1Row = makeD1ThreadRow({ forum_id: 10, author_id: 100, views: 42, recommends: 3 });
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=10"),
				env,
			);

			const data = await response.json();
			const thread = data.data[0];
			// Verify camelCase mapping
			expect(thread.forumId).toBe(10);
			expect(thread.authorId).toBe(100);
			expect(thread.authorName).toBe("alice");
			expect(thread.createdAt).toBe(1711540800);
			expect(thread.lastPostAt).toBe(1711544400);
			expect(thread.lastPoster).toBe("bob");
			// Verify internal field stripped
			expect(thread.post_table_id).toBeUndefined();
			expect(thread.postTableId).toBeUndefined();
			// Verify no snake_case leaks
			expect(thread.forum_id).toBeUndefined();
			expect(thread.author_id).toBeUndefined();
		});

		it("should query threads without cursor on first page", async () => {
			const d1Row = makeD1ThreadRow();
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=1"), env);

			expect(prepareSpy).toHaveBeenCalledWith(
				expect.stringContaining("ORDER BY sticky DESC, last_post_at DESC"),
			);
			expect(bindSpy).toHaveBeenCalledWith(1, 100);
		});

		it("should decode and use cursor for pagination", async () => {
			const cursor = btoa(
				JSON.stringify({
					sticky: 1,
					lastPostAt: 1234567890,
					id: 100,
				}),
			);
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(
				new Request(
					`https://example.com/api/v1/threads?forumId=1&cursor=${encodeURIComponent(cursor)}`,
				),
				env,
			);

			expect(bindSpy).toHaveBeenCalledWith(
				1,
				1, // sticky
				1, // sticky
				1234567890, // lastPostAt
				1234567890, // lastPostAt
				100, // id
				100, // limit
			);
		});

		it("should generate valid next cursor that roundtrips correctly", async () => {
			const threads = Array.from({ length: 20 }, (_, i) =>
				makeD1ThreadRow({
					id: i + 1,
					sticky: 0,
					last_post_at: 1234567890 + i,
				}),
			);

			const allSpy = mock(() => Promise.resolve({ results: threads }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=20"),
				env,
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeDefined();

			// Decode and verify cursor roundtrip
			const decoded = JSON.parse(atob(data.meta.nextCursor));
			expect(decoded.sticky).toBe(0);
			expect(decoded.lastPostAt).toBe(1234567890 + 19);
			expect(decoded.id).toBe(20);
		});

		it("should not generate next cursor when results are less than limit", async () => {
			const d1Row = makeD1ThreadRow();
			const allSpy = mock(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=20"),
				env,
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeNull();
		});

		it("should include metadata in response", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(new Request("https://example.com/api/v1/threads?forumId=1"), env);

			const data = await response.json();
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
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
					`https://example.com/api/v1/threads?forumId=1&cursor=${encodeURIComponent(invalidCursor)}`,
				),
				env,
			);

			// Should fall back to first page query
			expect(prepareSpy).toHaveBeenCalledWith(expect.not.stringContaining("sticky <"));
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
					`https://example.com/api/v1/threads?forumId=1&cursor=${encodeURIComponent(malformedCursor)}`,
				),
				env,
			);

			// Should fall back to first page query
			expect(prepareSpy).toHaveBeenCalledWith(expect.not.stringContaining("sticky <"));
		});

		it("should use default limit of 100 when no limit parameter provided", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({
				all: allSpy,
			}));
			const db = {
				prepare: mock(() => ({ bind: bindSpy })),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=1"), env);

			expect(bindSpy).toHaveBeenCalledWith(1, 100);
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

			await list(new Request("https://example.com/api/v1/threads?forumId=1&limit=30"), env);

			expect(bindSpy).toHaveBeenCalledWith(1, 30);
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
				new Request("https://example.com/api/v1/threads?forumId=1", {
					headers: {
						Origin: "http://localhost:3000",
					},
				}),
				env,
			);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});

		it("should include CORS headers on error responses", async () => {
			const response = await list(
				new Request("https://example.com/api/v1/threads", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				mockEnv,
			);

			expect(response.status).toBe(400);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});
	});

	describe("getById", () => {
		it("should map D1 row to camelCase Thread when found", async () => {
			const d1Row = makeD1ThreadRow({ id: 123, forum_id: 10, author_id: 100 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const runSpy = mock(() => Promise.resolve({ success: true }));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/threads/123"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.id).toBe(123);
			expect(data.data.forumId).toBe(10);
			expect(data.data.authorId).toBe(100);
			expect(data.data.createdAt).toBe(1711540800);
			// No snake_case leaks
			expect(data.data.forum_id).toBeUndefined();
			// No internal fields
			expect(data.data.post_table_id).toBeUndefined();
		});

		it("should return 404 when thread not found", async () => {
			const firstSpy = mock(() => Promise.resolve(null));
			const runSpy = mock(() => Promise.resolve({ success: true }));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/threads/999"), env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should parse thread ID from URL", async () => {
			const d1Row = makeD1ThreadRow({ id: 456 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const runSpy = mock(() => Promise.resolve({ success: true }));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/threads/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});

		it("should increment view count when thread is fetched", async () => {
			const d1Row = makeD1ThreadRow({ id: 42 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const runSpy = mock(() => Promise.resolve({ success: true }));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));
			const prepareSpy = mock((_sql: string) => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/threads/42"), env);

			// Should call prepare for UPDATE threads SET views
			const updateCall = prepareSpy.mock.calls.find((c) =>
				(c[0] as string).includes("UPDATE threads SET views"),
			);
			expect(updateCall).toBeDefined();
		});

		it("should increment views even if UPDATE fails (fire-and-forget)", async () => {
			const d1Row = makeD1ThreadRow({ id: 42 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const runSpy = mock(() => Promise.resolve({ success: true }));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));
			const prepareSpy = mock((_sql: string) => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/threads/42"), env);

			// Should still return 200 despite UPDATE failure
			expect(response.status).toBe(200);
			const updateCall = prepareSpy.mock.calls.find((c) =>
				(c[0] as string).includes("UPDATE threads SET views"),
			);
			expect(updateCall).toBeDefined();
		});
	});

	describe("create", () => {
		it("should require authentication", async () => {
			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
				}),
				mockEnv,
			);

			expect(response.status).toBe(401);
		});

		it("should validate required fields", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }) },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1 }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should require valid forumId", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }) },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: "invalid" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should reject non-existent forum", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": null },
				runResults: { "": { success: true, meta: { last_row_id: 100 } } },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "Test", content: "Test content" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("FORUM_NOT_FOUND");
		});

		it("should validate subject length", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }) },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						forumId: 1,
						subject: "a".repeat(201),
						content: "Test content",
					}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("subject must be at most 200 characters");
		});

		it("should create thread with first post and update counts", async () => {
			const token = await createJwtForRole(0, 42);
			const createdThread = makeD1ThreadRow({ id: 100, forum_id: 1 });
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT * FROM threads WHERE id": createdThread,
				},
				runResults: {
					"": { success: true, meta: { last_row_id: 100 } },
					"INSERT INTO threads": { success: true, meta: { last_row_id: 100 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						forumId: 1,
						subject: "Test Thread",
						content: "<p>Test content</p>",
					}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.id).toBe(100);
			expect(body.data.subject).toBe("Test Thread");

			// Verify batch was called: 1 post INSERT + 2 count updates = 3 statements
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(3);
		});

		it("should trim subject and content", async () => {
			const token = await createJwtForRole(0, 42);
			const createdThread = makeD1ThreadRow({ id: 100 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT * FROM threads WHERE id": createdThread,
				},
				runResults: {
					"": { success: true, meta: { last_row_id: 100 } },
				},
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						forumId: 1,
						subject: "  Test Thread  ",
						content: "  <p>Test content</p>  ",
					}),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(201);
			const body = await response.json();
			expect(body.data.subject).toBe("Test Thread");
		});

		it("should reject empty subject after trimming", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }) },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "   ", content: "Test" }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("subject is required");
		});

		it("should reject empty content after trimming", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }) },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "Test", content: "   " }),
				}),
				{ ...mockEnv, DB: db },
			);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("content is required");
		});

		it("should handle malformed JSON", async () => {
			const token = await createJwtForRole(0, 1);
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": makeD1ForumRow({ id: 1 }) },
			});

			const response = await create(
				new Request("https://example.com/api/v1/threads", {
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
