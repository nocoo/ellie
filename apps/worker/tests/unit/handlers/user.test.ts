import { describe, expect, it, vi } from "vitest";
import {
	getAvatarPath,
	getById,
	listDigest,
	listPosts,
	listThreads,
	search,
} from "../../../src/handlers/user";
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
			const firstSpy = vi.fn(() => Promise.resolve(d1Row));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const firstSpy = vi.fn(() => Promise.resolve(d1Row));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const firstSpy = vi.fn(() => Promise.resolve(d1Row));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/users/123"), env);

			const sql = prepareSpy.mock.calls[0][0] as string;
			// Should NOT use SELECT *
			expect(sql).not.toContain("SELECT *");

			// Allowlist approach: parse the column list between SELECT and FROM,
			// and assert every selected column appears in the explicit allowlist.
			// This is more robust than a denylist — any newly-added sensitive
			// field will fail the test instead of silently leaking.
			const match = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\b/i);
			expect(match).not.toBeNull();
			const columns = (match?.[1] ?? "")
				.split(",")
				.map((c) => c.trim())
				.filter((c) => c.length > 0);

			// PublicUser fields exposed via toPublicUser mapper, plus `status`
			// which is selected to gate visibility but never returned to clients.
			const ALLOWED_COLUMNS = new Set([
				"id",
				"username",
				"avatar",
				"avatar_path",
				"role",
				"reg_date",
				"threads",
				"posts",
				"credits",
				"coins",
				"signature",
				"group_title",
				"group_stars",
				"group_color",
				"custom_title",
				"digest_posts",
				"ol_time",
				"last_activity",
				"gender",
				"birth_year",
				"birth_month",
				"birth_day",
				"reside_province",
				"reside_city",
				"graduate_school",
				"bio",
				"interest",
				"qq",
				"site",
				"reg_ip",
				"last_ip",
				"status",
			]);

			for (const col of columns) {
				expect(ALLOWED_COLUMNS.has(col)).toBe(true);
			}

			// Sensitive columns must never appear in the selection.
			expect(columns).not.toContain("email");
			expect(columns).not.toContain("last_login");
			expect(columns).not.toContain("password_hash");
			expect(columns).not.toContain("password_salt");
		});

		it("should return 404 with CORS headers when user not found", async () => {
			const firstSpy = vi.fn(() => Promise.resolve(null));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const firstSpy = vi.fn(() => Promise.resolve(d1Row));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const firstSpy = vi.fn(() => Promise.resolve(d1Row));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/users/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});

		it("should handle non-numeric ID gracefully", async () => {
			const firstSpy = vi.fn(() => Promise.resolve(null));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/abc"), env);

			// NaN should result in not found
			expect(response.status).toBe(404);
		});

		it("should include CORS headers with valid origin", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = vi.fn(() => Promise.resolve(d1Row));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
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

	describe("getAvatarPath", () => {
		it("should return avatarPath for user with GUID avatar", async () => {
			const firstSpy = vi.fn(() => Promise.resolve({ avatar_path: "avatars/abc123.jpg" }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ first: firstSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getAvatarPath(
				new Request("https://example.com/api/v1/users/123/avatar-path"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.avatarPath).toBe("avatars/abc123.jpg");
		});

		it("should return empty avatarPath for user without GUID avatar", async () => {
			const firstSpy = vi.fn(() => Promise.resolve({ avatar_path: "" }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ first: firstSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getAvatarPath(
				new Request("https://example.com/api/v1/users/123/avatar-path"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.avatarPath).toBe("");
		});

		it("should return 404 for non-existent user", async () => {
			const firstSpy = vi.fn(() => Promise.resolve(null));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ first: firstSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getAvatarPath(
				new Request("https://example.com/api/v1/users/999/avatar-path"),
				env,
			);

			expect(response.status).toBe(404);
		});

		it("should NOT check user status (return data even for banned users)", async () => {
			// This is intentional — avatar proxy needs to display avatars for
			// banned/archived users whose historical posts are still visible
			const firstSpy = vi.fn(() => Promise.resolve({ avatar_path: "avatars/banned-user.jpg" }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ first: firstSpy }));
			const prepareSpy = vi.fn((sql: string) => {
				// Verify the query does NOT include status check
				expect(sql).not.toContain("AND status");
				return { bind: bindSpy };
			});
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getAvatarPath(
				new Request("https://example.com/api/v1/users/123/avatar-path"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.avatarPath).toBe("avatars/banned-user.jpg");
		});

		it("should return 400 for invalid userId", async () => {
			const response = await getAvatarPath(
				new Request("https://example.com/api/v1/users/abc/avatar-path"),
				mockEnv,
			);

			expect(response.status).toBe(400);
		});
	});

	describe("listThreads — edge cases", () => {
		it("should return 400 for invalid userId", async () => {
			const response = await listThreads(
				new Request("https://example.com/api/v1/users/0/threads"),
				mockEnv,
			);
			expect(response.status).toBe(400);
		});

		it("should return 400 for negative userId", async () => {
			const response = await listThreads(
				new Request("https://example.com/api/v1/users/-1/threads"),
				mockEnv,
			);
			expect(response.status).toBe(400);
		});

		it("should return nextCursor when results equal limit", async () => {
			// Create exactly 1 row and set limit=1
			const rows = [
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
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listThreads(
				new Request("https://example.com/api/v1/users/123/threads?limit=1"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(1);
			expect(data.meta.nextCursor).not.toBeNull();
		});

		it("should clamp limit to MAX_HISTORY_LIMIT", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await listThreads(new Request("https://example.com/api/v1/users/123/threads?limit=999"), env);

			// The last bind param should be 50 (MAX_HISTORY_LIMIT)
			const lastBindCall = bindSpy.mock.calls[0];
			expect(lastBindCall[lastBindCall.length - 1]).toBe(50);
		});
	});

	describe("listPosts — edge cases", () => {
		it("should return 400 for invalid userId", async () => {
			const response = await listPosts(
				new Request("https://example.com/api/v1/users/0/posts"),
				mockEnv,
			);
			expect(response.status).toBe(400);
		});

		it("should use keyset WHERE clause when cursor is provided", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const cursor = btoa(JSON.stringify({ createdAt: 1711540800, id: 200 }));
			await listPosts(
				new Request(`https://example.com/api/v1/users/123/posts?cursor=${cursor}`),
				env,
			);

			const sql = prepareSpy.mock.calls[0][0] as string;
			expect(sql).toContain("created_at < ?");
		});

		it("should return nextCursor when results equal limit", async () => {
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
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listPosts(
				new Request("https://example.com/api/v1/users/123/posts?limit=1"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.meta.nextCursor).not.toBeNull();
		});
	});

	describe("listDigest", () => {
		it("should return 400 for invalid userId", async () => {
			const response = await listDigest(
				new Request("https://example.com/api/v1/users/0/digest"),
				mockEnv,
			);
			expect(response.status).toBe(400);
		});

		it("should return digest threads for a valid user", async () => {
			const rows = [
				{
					id: 100,
					forum_id: 1,
					author_id: 123,
					author_name: "testuser",
					subject: "Digest Thread",
					created_at: 1711540800,
					last_post_at: 1711544400,
					last_poster: "bob",
					replies: 5,
					views: 100,
					closed: 0,
					sticky: 0,
					digest: 2,
					special: 0,
					highlight: 0,
					recommends: 0,
					post_table_id: 1,
				},
			];
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listDigest(
				new Request("https://example.com/api/v1/users/123/digest"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(1);
			expect(data.data[0].digest).toBe(2);

			// SQL should filter by digest > 0
			const sql = prepareSpy.mock.calls[0][0] as string;
			expect(sql).toContain("digest > 0");
		});

		it("should return empty array when no digest threads", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listDigest(
				new Request("https://example.com/api/v1/users/123/digest"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual([]);
			expect(data.meta.nextCursor).toBeNull();
		});

		it("should use cursor for keyset pagination", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const cursor = btoa(JSON.stringify({ createdAt: 1711540800, id: 100 }));
			await listDigest(
				new Request(`https://example.com/api/v1/users/123/digest?cursor=${cursor}`),
				env,
			);

			const sql = prepareSpy.mock.calls[0][0] as string;
			expect(sql).toContain("created_at < ?");
		});

		it("should return nextCursor when results equal limit", async () => {
			const rows = [
				{
					id: 100,
					forum_id: 1,
					author_id: 123,
					author_name: "testuser",
					subject: "Digest Thread",
					created_at: 1711540800,
					last_post_at: 1711544400,
					last_poster: "bob",
					replies: 5,
					views: 100,
					closed: 0,
					sticky: 0,
					digest: 1,
					special: 0,
					highlight: 0,
					recommends: 0,
					post_table_id: 1,
				},
			];
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await listDigest(
				new Request("https://example.com/api/v1/users/123/digest?limit=1"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.meta.nextCursor).not.toBeNull();
		});
	});

	describe("search", () => {
		it("should return 400 when query is missing", async () => {
			const response = await search(
				new Request("https://example.com/api/v1/users/search"),
				mockEnv,
			);
			expect(response.status).toBe(400);
		});

		it("should return 400 when query is too short", async () => {
			const response = await search(
				new Request("https://example.com/api/v1/users/search?q=a"),
				mockEnv,
			);
			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.details.message).toContain("at least 2 characters");
		});

		it("should return matching users", async () => {
			const rows = [
				{ id: 1, username: "alice" },
				{ id: 2, username: "alex" },
			];
			const allSpy = vi.fn(() => Promise.resolve({ results: rows }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await search(
				new Request("https://example.com/api/v1/users/search?q=al"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(2);
			expect(data.data[0].username).toBe("alice");

			// Verify bind params: prefix match + limit
			expect(bindSpy.mock.calls[0][0]).toBe("al%");
			expect(bindSpy.mock.calls[0][1]).toBe(10); // default limit
		});

		it("should clamp limit to MAX_SEARCH_LIMIT", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await search(new Request("https://example.com/api/v1/users/search?q=test&limit=100"), env);

			expect(bindSpy.mock.calls[0][1]).toBe(20); // MAX_SEARCH_LIMIT
		});

		it("should escape special LIKE characters", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await search(new Request("https://example.com/api/v1/users/search?q=te%25st"), env);

			// % should be escaped
			expect(bindSpy.mock.calls[0][0]).toBe("te\\%st%");
		});

		it("should return empty array when no matches", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await search(
				new Request("https://example.com/api/v1/users/search?q=zzz"),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual([]);
		});

		it("should use custom limit when provided", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ all: allSpy }));
			const prepareSpy = vi.fn(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await search(new Request("https://example.com/api/v1/users/search?q=test&limit=5"), env);

			expect(bindSpy.mock.calls[0][1]).toBe(5);
		});
	});
});
