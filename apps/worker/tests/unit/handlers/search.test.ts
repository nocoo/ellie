import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchThreads } from "../../../src/handlers/search";
import type { Env } from "../../../src/lib/env";
import {
	TEST_JWT_SECRET,
	createJwtForRole,
	createMockCtx,
	createMockKV,
	makeD1ThreadRow,
} from "../../helpers";

describe("search handlers", () => {
	// Note: settings now go through the settings KV cache (`getSetting` →
	// `getSettings` → `env.KV.get("settings:all")`). Reset the KV before
	// each test so a "search disabled" fixture in one test does not bleed
	// into the next via the cached "settings:all" entry.
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		ADMIN_API_KEY: "test-admin-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
		USE_KV_USER_CACHE: "false",
	};

	beforeEach(() => {
		mockEnv.KV = createMockKV();
	});

	const getCtx = () => createMockCtx();

	describe("searchThreads", () => {
		// Helper to create mock DB. The search handler now reads settings via
		// `getSetting()` which goes through the settings KV cache; on cache
		// miss it falls back to a `SELECT key, value, type, updated_at FROM
		// settings` table scan. We mock that scan and return a single row
		// for `general.search.enabled` of type=boolean.
		function createSearchDb(config: {
			searchEnabled?: boolean;
			searchResults?: unknown[];
			countResult?: number;
		}) {
			return {
				prepare: vi.fn((sql: string) => {
					// Settings full-table scan (consumed by getSettings → getSetting)
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: config.searchEnabled === false ? "false" : "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					// Count query
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: config.countResult ?? 0 })),
							})),
						};
					}
					// Search query
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({
								results: config.searchResults ?? [],
							})),
						})),
					};
				}),
			} as unknown as D1Database;
		}

		it("returns 503 when search is disabled", async () => {
			const db = createSearchDb({ searchEnabled: false });
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(503);
			const data = await response.json();
			expect(data.error.code).toBe("FEATURE_DISABLED");
		});

		it("returns 400 for empty query", async () => {
			const db = createSearchDb({ searchEnabled: true });
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
			// Message comes from error.ts getStatusMessage, details has the specific message
			expect(data.error.details?.message).toContain("at least 2 characters");
		});

		it("returns 400 for query with less than 2 characters", async () => {
			const db = createSearchDb({ searchEnabled: true });
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=a"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("returns 400 for invalid cursor format (non-base64)", async () => {
			const db = createSearchDb({ searchEnabled: true });
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test&cursor=invalid!!!"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
			expect(data.error.details?.message).toContain("cursor");
		});

		it("returns 400 for invalid cursor format (valid base64, invalid JSON)", async () => {
			const db = createSearchDb({ searchEnabled: true });
			const env = { ...mockEnv, DB: db };

			// btoa("not-json")
			const invalidCursor = btoa("not-json");
			const response = await searchThreads(
				new Request(`https://api.example.com/api/v1/search/threads?q=test&cursor=${invalidCursor}`),
				env,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("returns 400 for invalid cursor format (valid JSON, wrong shape)", async () => {
			const db = createSearchDb({ searchEnabled: true });
			const env = { ...mockEnv, DB: db };

			// btoa('{"foo":"bar"}')
			const invalidCursor = btoa('{"foo":"bar"}');
			const response = await searchThreads(
				new Request(`https://api.example.com/api/v1/search/threads?q=test&cursor=${invalidCursor}`),
				env,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("returns results for valid query", async () => {
			const threadRow = makeD1ThreadRow({ subject: "同济大学测试主题" });
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: [threadRow],
				countResult: 1,
			});
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=同济"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toHaveLength(1);
			expect(data.data[0].subject).toBe("同济大学测试主题");
			expect(data.meta.total).toBe(1);
		});

		it("respects limit parameter", async () => {
			const threads = [
				makeD1ThreadRow({ id: 1 }),
				makeD1ThreadRow({ id: 2 }),
				makeD1ThreadRow({ id: 3 }),
			];
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: threads,
				countResult: 3,
			});
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test&limit=2"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			// Limit 2 + 1 for pagination check = 3 returned, but should show 2
			expect(data.data.length).toBeLessThanOrEqual(2);
		});

		it("clamps limit to max 50", async () => {
			const allSpy = vi.fn(async () => ({ results: [] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					return {
						bind: vi.fn((...args: unknown[]) => {
							// Last arg is limit + 1
							const limitArg = args[args.length - 1];
							expect(limitArg).toBe(51); // 50 + 1 for pagination
							return { all: allSpy };
						}),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test&limit=100"),
				env,
				getCtx(),
			);

			expect(allSpy).toHaveBeenCalled();
		});

		it("supports cursor pagination", async () => {
			const threadRow = makeD1ThreadRow({
				id: 1,
				last_post_at: 1711544400,
			});
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: [threadRow],
				countResult: 1,
			});
			const env = { ...mockEnv, DB: db };

			// Create valid cursor
			const cursor = btoa(JSON.stringify({ lastPostAt: 1711544400, id: 2 }));
			const response = await searchThreads(
				new Request(`https://api.example.com/api/v1/search/threads?q=test&cursor=${cursor}`),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toBeDefined();
		});

		it("returns total count on first page only", async () => {
			const threadRow = makeD1ThreadRow();
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: [threadRow],
				countResult: 42,
			});
			const env = { ...mockEnv, DB: db };

			// First page (no cursor) should have total
			const response1 = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				env,
				getCtx(),
			);

			expect(response1.status).toBe(200);
			const data1 = await response1.json();
			expect(data1.meta.total).toBe(42);

			// Second page (with cursor) should not call count
			const cursor = btoa(JSON.stringify({ lastPostAt: 1711544400, id: 2 }));
			const countCalled = { value: false };
			const db2 = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						countCalled.value = true;
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [threadRow] })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env2 = { ...mockEnv, DB: db2 };

			await searchThreads(
				new Request(`https://api.example.com/api/v1/search/threads?q=test&cursor=${cursor}`),
				env2,
				getCtx(),
			);

			expect(countCalled.value).toBe(false);
		});

		it("handles FTS5 special characters (quotes)", async () => {
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: [],
				countResult: 0,
			});
			const env = { ...mockEnv, DB: db };

			// Query with quotes should not cause error
			const response = await searchThreads(
				new Request('https://api.example.com/api/v1/search/threads?q=test"quote'),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
		});

		it("handles multi-keyword AND search", async () => {
			let capturedFtsQuery = "";
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn((ftsQuery: string) => {
								capturedFtsQuery = ftsQuery;
								return {
									first: vi.fn(async () => ({ cnt: 0 })),
								};
							}),
						};
					}
					return {
						bind: vi.fn((ftsQuery: string) => {
							capturedFtsQuery = ftsQuery;
							return {
								all: vi.fn(async () => ({ results: [] })),
							};
						}),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=同济%20毕业典礼"),
				env,
				getCtx(),
			);

			// FTS query should be quoted terms
			expect(capturedFtsQuery).toBe('"同济" "毕业典礼"');
		});

		it("returns complete Thread fields", async () => {
			const threadRow = makeD1ThreadRow({
				id: 123,
				forum_id: 5,
				author_id: 1001,
				author_name: "张三",
				subject: "同济大学2024届毕业典礼",
				created_at: 1704067200,
				last_post_at: 1704153600,
				last_poster: "李四",
				last_poster_id: 1002,
				replies: 42,
				views: 1234,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 1,
				highlight: 1,
				recommends: 5,
				type_name: "活动",
			});
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: [threadRow],
				countResult: 1,
			});
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=同济"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			const thread = data.data[0];

			// Verify all expected fields
			expect(thread.id).toBe(123);
			expect(thread.forumId).toBe(5);
			expect(thread.authorId).toBe(1001);
			expect(thread.authorName).toBe("张三");
			expect(thread.subject).toBe("同济大学2024届毕业典礼");
			expect(thread.createdAt).toBe(1704067200);
			expect(thread.lastPostAt).toBe(1704153600);
			expect(thread.lastPoster).toBe("李四");
			expect(thread.lastPosterId).toBe(1002);
			expect(thread.replies).toBe(42);
			expect(thread.views).toBe(1234);
			expect(thread.closed).toBe(0);
			expect(thread.sticky).toBe(0);
			expect(thread.digest).toBe(0);
			expect(thread.special).toBe(1);
			expect(thread.highlight).toBe(1);
			expect(thread.recommends).toBe(5);
			expect(thread.typeName).toBe("活动");
			// Avatars should be empty strings when not enriched
			expect(thread.authorAvatar).toBe("");
			expect(thread.lastPosterAvatar).toBe("");
		});

		it("filters hidden threads (sticky < 0)", async () => {
			// This is tested through SQL query generation - verify the SQL includes visibility check
			let capturedSql = "";
			const db = {
				prepare: vi.fn((sql: string) => {
					capturedSql = sql;
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [] })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				env,
				getCtx(),
			);

			// SQL should include thread visibility filter
			expect(capturedSql).toContain("t.sticky >= 0");
		});

		it("filters threads in hidden forums", async () => {
			let capturedSql = "";
			const db = {
				prepare: vi.fn((sql: string) => {
					capturedSql = sql;
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [] })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				env,
				getCtx(),
			);

			// SQL should include forum status filter
			expect(capturedSql).toContain("f.status = 1");
		});

		it("respects forum visibility levels for anonymous user", async () => {
			let capturedSql = "";
			const db = {
				prepare: vi.fn((sql: string) => {
					capturedSql = sql;
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [] })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Anonymous user (no auth header)
			await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				env,
				getCtx(),
			);

			// SQL should only include public visibility for anonymous
			expect(capturedSql).toContain("f.visibility = 'public'");
			// Should NOT include members/staff/admin for anonymous
			expect(capturedSql).not.toContain("f.visibility = 'members'");
		});

		it("respects forum visibility levels for logged-in user", async () => {
			let capturedSql = "";
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					// optionalAuthVerified checks user in DB
					if (sql.includes("SELECT role, status FROM users")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ role: 0, status: 0 })),
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						capturedSql = sql;
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					capturedSql = sql;
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [] })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Logged-in user
			const token = await createJwtForRole(0); // Regular user
			const request = new Request("https://api.example.com/api/v1/search/threads?q=test", {
				headers: { Authorization: `Bearer ${token}` },
			});

			await searchThreads(request, env, getCtx());

			// SQL should include public AND members visibility
			expect(capturedSql).toContain("f.visibility = 'public'");
			expect(capturedSql).toContain("f.visibility = 'members'");
		});

		it("respects forum visibility levels for admin", async () => {
			let capturedSql = "";
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					// optionalAuthVerified checks user in DB
					if (sql.includes("SELECT role, status FROM users")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ role: 1, status: 0 })), // Admin role
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						capturedSql = sql;
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 0 })),
							})),
						};
					}
					capturedSql = sql;
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [] })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Admin user
			const token = await createJwtForRole(1); // Admin
			const request = new Request("https://api.example.com/api/v1/search/threads?q=test", {
				headers: { Authorization: `Bearer ${token}` },
			});

			await searchThreads(request, env, getCtx());

			// SQL should include ALL visibility levels
			expect(capturedSql).toContain("f.visibility = 'public'");
			expect(capturedSql).toContain("f.visibility = 'members'");
			expect(capturedSql).toContain("f.visibility = 'staff'");
			expect(capturedSql).toContain("f.visibility = 'admin'");
		});

		it("returns nextCursor when more results available", async () => {
			// Create 3 threads (limit 2 + 1 for pagination check)
			const threads = [
				makeD1ThreadRow({ id: 3, last_post_at: 1711544400 }),
				makeD1ThreadRow({ id: 2, last_post_at: 1711544300 }),
				makeD1ThreadRow({ id: 1, last_post_at: 1711544200 }),
			];
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: threads,
				countResult: 3,
			});
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test&limit=2"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.meta.nextCursor).toBeDefined();
			expect(data.meta.nextCursor).not.toBeNull();

			// Decode cursor to verify it's valid
			const cursor = JSON.parse(atob(data.meta.nextCursor));
			expect(cursor.lastPostAt).toBe(1711544300); // Second-to-last item
			expect(cursor.id).toBe(2);
		});

		it("returns null nextCursor when no more results", async () => {
			const threads = [makeD1ThreadRow({ id: 1 })];
			const db = createSearchDb({
				searchEnabled: true,
				searchResults: threads,
				countResult: 1,
			});
			const env = { ...mockEnv, DB: db };

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test&limit=10"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.meta.nextCursor).toBeNull();
		});

		it("enriches threads with user cache when enabled", async () => {
			const threadRow = makeD1ThreadRow({
				author_id: 100,
				last_poster_id: 200,
				author_name: "original_author",
				last_poster: "original_poster",
			});

			// Create mock KV with cached user profiles
			const kvStore = new Map<string, string>([
				[
					"user:mini:100",
					JSON.stringify({
						id: 100,
						username: "cached_author",
						avatar: "author_avatar.png",
						role: 0,
						groupTitle: "",
						groupColor: "",
						groupStars: 0,
					}),
				],
				[
					"user:mini:200",
					JSON.stringify({
						id: 200,
						username: "cached_poster",
						avatar: "poster_avatar.png",
						role: 0,
						groupTitle: "",
						groupColor: "",
						groupStars: 0,
					}),
				],
			]);

			const mockKV = {
				get: vi.fn(async (key: string, type?: string) => {
					const val = kvStore.get(key);
					if (!val) return null;
					if (type === "json") return JSON.parse(val);
					return val;
				}),
				put: vi.fn(async () => {}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace;

			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM settings")) {
						return {
							all: vi.fn(async () => ({
								results: [
									{
										key: "general.search.enabled",
										value: "true",
										type: "boolean",
										updated_at: 0,
									},
								],
							})),
						};
					}
					if (sql.includes("COUNT(*)")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => ({ cnt: 1 })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: vi.fn(async () => ({ results: [threadRow] })),
						})),
					};
				}),
			} as unknown as D1Database;

			const env = {
				...mockEnv,
				DB: db,
				KV: mockKV,
				USE_KV_USER_CACHE: "true",
			};

			const response = await searchThreads(
				new Request("https://api.example.com/api/v1/search/threads?q=test"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			const thread = data.data[0];

			// Should be enriched with cached data
			expect(thread.authorName).toBe("cached_author");
			expect(thread.authorAvatar).toBe("author_avatar.png");
			expect(thread.lastPoster).toBe("cached_poster");
			expect(thread.lastPosterAvatar).toBe("poster_avatar.png");
		});
	});
});
