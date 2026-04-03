import { describe, expect, it, mock } from "bun:test";
import { getById, listPosts, listThreads } from "../../../src/handlers/user";
import type { Env } from "../../../src/lib/env";
import { createMockKV } from "../../helpers";

describe("user handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: createMockKV(),
	};

	/** D1 row (snake_case) as it would come from SELECT with PublicUser columns */
	const makeD1UserRow = (overrides?: Record<string, unknown>) => ({
		id: 123,
		username: "testuser",
		avatar: "avatar.png",
		role: 1,
		reg_date: 1711540800,
		threads: 10,
		posts: 50,
		credits: 100,
		...overrides,
	});

	describe("getById", () => {
		it("should map D1 snake_case row to camelCase User", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/123"), env);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify camelCase mapping — PublicUser model (8 fields)
			expect(data.data.id).toBe(123);
			expect(data.data.username).toBe("testuser");
			expect(data.data.avatar).toBe("avatar.png");
			expect(data.data.role).toBe(1);
			expect(data.data.regDate).toBe(1711540800);
			expect(data.data.threads).toBe(10);
			expect(data.data.posts).toBe(50);
			expect(data.data.credits).toBe(100);

			// PublicUser should NOT contain sensitive fields
			expect(data.data.email).toBeUndefined();
			expect(data.data.status).toBeUndefined();
			expect(data.data.lastLogin).toBeUndefined();

			// No snake_case leaks
			expect(data.data.reg_date).toBeUndefined();

			// Metadata
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});

		it("should NOT leak password_hash or password_salt", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/123"), env);

			const data = await response.json();
			// Even if D1 somehow returned them, the mapper should strip them
			expect(data.data.password_hash).toBeUndefined();
			expect(data.data.password_salt).toBeUndefined();
			expect(data.data.passwordHash).toBeUndefined();
			expect(data.data.passwordSalt).toBeUndefined();
		});

		it("should SELECT specific columns (not SELECT *)", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/users/123"), env);

			const sql = prepareSpy.mock.calls[0][0] as string;
			// Should NOT use SELECT *
			expect(sql).not.toContain("SELECT *");
			// Should explicitly list PublicUser columns
			expect(sql).toContain("id");
			expect(sql).toContain("username");
			expect(sql).toContain("avatar");
			expect(sql).toContain("role");
			expect(sql).toContain("reg_date");
			expect(sql).toContain("threads");
			expect(sql).toContain("posts");
			expect(sql).toContain("credits");
			// status is queried to check for banned users, but not returned
			expect(sql).toContain("status");
			// Should NOT contain other sensitive columns
			expect(sql).not.toContain("email");
			expect(sql).not.toContain("last_login");
			expect(sql).not.toContain("password_hash");
			expect(sql).not.toContain("password_salt");
		});

		it("should return 404 with CORS headers when user not found", async () => {
			const firstSpy = mock(() => Promise.resolve(null));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/users/999", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				env,
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should return 404 for banned users (status = -1)", async () => {
			const d1Row = makeD1UserRow({ id: 123, status: -1 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/users/123", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				env,
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
		});

		it("should parse user ID from URL", async () => {
			const d1Row = makeD1UserRow({ id: 456 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/users/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});

		it("should handle non-numeric ID gracefully", async () => {
			const firstSpy = mock(() => Promise.resolve(null));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/abc"), env);

			// NaN should result in not found
			expect(response.status).toBe(404);
		});

		it("should include CORS headers with valid origin", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/users/123", {
					headers: {
						Origin: "http://localhost:3000",
					},
				}),
				env,
			);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});
	});

	describe("listThreads", () => {
		const makeD1ThreadRows = () => [
			{
				id: 100,
				forum_id: 1,
				author_id: 123,
				author_name: "testuser",
				subject: "Thread One",
				created_at: 1711540800,
				last_post_at: 1711544400,
				last_poster: "bob",
				replies: 5,
				views: 100,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				post_table_id: 1,
			},
		];

		it("should return threads for a valid user", async () => {
			const rows = makeD1ThreadRows();
			const allSpy = mock(() => Promise.resolve({ results: rows }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listThreads(
				new Request("https://example.com/api/v1/users/123/threads"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(1);
			expect(data.data[0].id).toBe(100);
			expect(data.data[0].subject).toBe("Thread One");
			expect(data.data[0].forumId).toBe(1);
			expect(data.meta.nextCursor).toBeNull(); // only 1 result, limit 20
		});

		it("should return empty array when user has no threads", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listThreads(
				new Request("https://example.com/api/v1/users/999/threads"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual([]);
			expect(data.meta.nextCursor).toBeNull();
		});

		it("should use keyset WHERE clause when cursor is provided", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const cursor = btoa(JSON.stringify({ createdAt: 1711540800, id: 100 }));
			await listThreads(
				new Request(`https://example.com/api/v1/users/123/threads?cursor=${cursor}`),
				env,
			);

			const sql = prepareSpy.mock.calls[0][0] as string;
			expect(sql).toContain("created_at < ?");
		});

		it("should parse userId from URL path", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await listThreads(new Request("https://example.com/api/v1/users/456/threads"), env);

			// First bind param should be the userId
			expect(bindSpy.mock.calls[0][0]).toBe(456);
		});
	});

	describe("listPosts", () => {
		it("should return posts for a valid user", async () => {
			const rows = [
				{
					id: 200,
					thread_id: 10,
					forum_id: 1,
					author_id: 123,
					author_name: "testuser",
					content: "<p>Hello</p>",
					created_at: 1711540800,
					is_first: 0,
					position: 2,
				},
			];
			const allSpy = mock(() => Promise.resolve({ results: rows }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listPosts(
				new Request("https://example.com/api/v1/users/123/posts"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(1);
			expect(data.data[0].id).toBe(200);
			expect(data.data[0].threadId).toBe(10);
			expect(data.data[0].content).toBe("<p>Hello</p>");
		});

		it("should return empty array when user has no posts", async () => {
			const allSpy = mock(() => Promise.resolve({ results: [] }));
			const bindSpy = mock((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listPosts(
				new Request("https://example.com/api/v1/users/999/posts"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual([]);
		});
	});
});
