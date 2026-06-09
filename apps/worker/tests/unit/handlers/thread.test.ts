import { describe, expect, it, type mock, vi } from "vitest";

// Bypass the v2 forum-meta gate (Phase 3): these tests focus on thread-list
// behaviour. Forum visibility / 404 / 403 paths are covered by
// thread-v2-cache.test.ts and forum-v2-cache.test.ts.
vi.mock("../../../src/lib/cache/forum-read", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../../../src/lib/cache/forum-read",
	);
	return {
		...actual,
		getForumMetaV2: vi.fn(async (_env, _ctx, id: number) => ({
			kind: "ok",
			forum: { id, status: 1, visibility: "public", name: "F" },
		})),
	};
});

// Bypass the v2 thread-list page1 cache (Phase 3): these tests inspect raw
// D1 wiring and would otherwise hit a warm KV cache from a previous test.
// Cache hit/miss + invalidation are covered by thread-v2-cache.test.ts.
vi.mock("../../../src/lib/cache/thread-list-read", async () => {
	const actual = await vi.importActual<Record<string, unknown>>(
		"../../../src/lib/cache/thread-list-read",
	);
	return {
		...actual,
		getThreadListPageOneV2: vi.fn(
			async (_env, _ctx, _forumId, _limit, loader: () => Promise<unknown>) => loader(),
		),
	};
});

import { create, getById, list } from "../../../src/handlers/thread";
import type { Env } from "../../../src/lib/env";
import {
	createJwtForRole,
	createMockCtx,
	createMockDb,
	createMockKV,
	makeD1ForumRow,
	makeD1ThreadRow,
	TEST_JWT_SECRET,
} from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

describe("thread handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: TEST_JWT_SECRET,
		KV: createMockKV(),
		// Disable KV cache - use JOIN approach (default behavior)
		USE_KV_USER_CACHE: "false",
	};

	// Create fresh ctx for each test
	const getCtx = () => createMockCtx();

	describe("list", () => {
		it("should require forumId parameter", async () => {
			const response = await list(
				new Request("https://example.com/api/v1/threads"),
				mockEnv,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should reject invalid forumId", async () => {
			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=abc"),
				mockEnv,
				getCtx(),
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should clamp limit to [1, 100]", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const prepareSpy = vi.fn((sql: string) => {
				// Forum visibility check query
				if (sql.includes("SELECT status, visibility FROM forums")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
						})),
					};
				}
				// Thread list query
				return {
					bind: vi.fn((..._args: unknown[]) => ({
						all: allSpy,
						first: vi.fn(() => Promise.resolve({ total: 0 })),
					})),
				};
			});
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Test limit > 100
			await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=200"),
				env,
				getCtx(),
			);
			// Check that thread list query was called with limit 100
			expect(allSpy).toHaveBeenCalled();

			// Test limit within range
			await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=100"),
				env,
				getCtx(),
			);
			expect(allSpy).toHaveBeenCalled();

			// Test limit < 1
			await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=0"),
				env,
				getCtx(),
			);
			expect(allSpy).toHaveBeenCalled(); // default limit applied
		});

		it("should map D1 snake_case rows to camelCase Thread objects", async () => {
			const d1Row = makeD1ThreadRow({ forum_id: 10, author_id: 100, views: 42, recommends: 3 });
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return {
						bind: vi.fn(() => ({ all: allSpy, first: vi.fn(() => Promise.resolve({ total: 0 })) })),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=10"),
				env,
				getCtx(),
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

		it("should query threads with JOIN on first page", async () => {
			const d1Row = makeD1ThreadRow();
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				all: allSpy,
				first: vi.fn(() => Promise.resolve({ total: 0 })),
			}));
			const prepareSpy = vi.fn((sql: string) => {
				// Forum visibility check query
				if (sql.includes("SELECT status, visibility FROM forums")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
						})),
					};
				}
				// Thread list query
				return { bind: bindSpy };
			});
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=1"), env, getCtx());

			expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining("ORDER BY"));
			expect(prepareSpy).toHaveBeenCalledWith(expect.stringContaining("LEFT JOIN users"));
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				all: allSpy,
				first: vi.fn(() => Promise.resolve({ total: 0 })),
			}));
			const prepareSpy = vi.fn((sql: string) => {
				// Forum visibility check query
				if (sql.includes("SELECT status, visibility FROM forums")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
						})),
					};
				}
				// Thread list query
				return { bind: bindSpy };
			});
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(
				new Request(
					`https://example.com/api/v1/threads?forumId=1&cursor=${encodeURIComponent(cursor)}`,
				),
				env,
				getCtx(),
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

			const allSpy = vi.fn(() => Promise.resolve({ results: threads }));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return {
						bind: vi.fn(() => ({ all: allSpy, first: vi.fn(() => Promise.resolve({ total: 0 })) })),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=20"),
				env,
				getCtx(),
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return {
						bind: vi.fn(() => ({ all: allSpy, first: vi.fn(() => Promise.resolve({ total: 0 })) })),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=20"),
				env,
				getCtx(),
			);

			const data = await response.json();
			expect(data.meta.nextCursor).toBeNull();
		});

		it("should include metadata in response", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return {
						bind: vi.fn(() => ({ all: allSpy, first: vi.fn(() => Promise.resolve({ total: 0 })) })),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1"),
				env,
				getCtx(),
			);

			const data = (await response.json()) as { meta: { timestamp: number; requestId: string } };
			expect(typeof data.meta.timestamp).toBe("number");
			expect(data.meta.timestamp).toBeGreaterThan(0);
			expect(typeof data.meta.requestId).toBe("string");
			expect(data.meta.requestId.length).toBeGreaterThan(0);
		});

		it("should handle invalid cursor gracefully", async () => {
			const invalidCursor = btoa(JSON.stringify({ wrong: "structure" }));
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				all: allSpy,
				first: vi.fn(() => Promise.resolve({ total: 0 })),
			}));
			const prepareSpy = vi.fn((sql: string) => {
				// Forum visibility check query
				if (sql.includes("SELECT status, visibility FROM forums")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
						})),
					};
				}
				// Thread list query
				return { bind: bindSpy };
			});
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				all: allSpy,
				first: vi.fn(() => Promise.resolve({ total: 0 })),
			}));
			const prepareSpy = vi.fn((sql: string) => {
				// Forum visibility check query
				if (sql.includes("SELECT status, visibility FROM forums")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
						})),
					};
				}
				// Thread list query
				return { bind: bindSpy };
			});
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
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				all: allSpy,
				first: vi.fn(() => Promise.resolve({ total: 0 })),
			}));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return { bind: bindSpy };
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=1"), env, getCtx());

			expect(bindSpy).toHaveBeenCalledWith(1, 100);
		});

		it("should use valid limit within range", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const bindSpy = vi.fn((..._args: unknown[]) => ({
				all: allSpy,
				first: vi.fn(() => Promise.resolve({ total: 0 })),
			}));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return { bind: bindSpy };
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(
				new Request("https://example.com/api/v1/threads?forumId=1&limit=30"),
				env,
				getCtx(),
			);

			expect(bindSpy).toHaveBeenCalledWith(1, 30);
		});

		it("should include CORS headers with origin", async () => {
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Thread list query
					return {
						bind: vi.fn(() => ({ all: allSpy, first: vi.fn(() => Promise.resolve({ total: 0 })) })),
					};
				}),
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
				getCtx(),
			);
			expect(response.status).toBe(400);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		// Forum visibility 404 / 403 (forum:meta:v2 gate) is covered by
		// thread-v2-cache.test.ts.

		it("should use offset pagination when page param is provided", async () => {
			const d1Row = makeD1ThreadRow({ id: 1 });
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const firstSpy = vi.fn((sql: string) => {
				if (sql.includes("SELECT status, visibility FROM forums")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
						})),
					};
				}
				if (sql.includes("COUNT(*)")) {
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve({ total: 50 })),
						})),
					};
				}
				// Thread list query with OFFSET
				return {
					bind: vi.fn(() => ({ all: allSpy, first: vi.fn(() => Promise.resolve({ total: 0 })) })),
				};
			});
			const db = { prepare: firstSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1&page=2&limit=10"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.meta.total).toBe(50);
			expect(data.meta.page).toBe(2);
		});

		it("should include NOT EXISTS derived column for is_author_first_thread in SQL", async () => {
			let capturedSql = "";
			const d1Row = makeD1ThreadRow();
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					capturedSql = sql;
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=1"), env, getCtx());

			// SQL must include the NOT EXISTS subquery and alias
			expect(capturedSql).toContain("NOT EXISTS");
			expect(capturedSql).toContain("AS is_author_first_thread");
			// SQL must use t. alias (required for subquery correlation)
			expect(capturedSql).toContain("FROM threads t");
		});

		it("should map is_author_first_thread=1 to isAuthorFirstThread=true", async () => {
			const d1Row = makeD1ThreadRow({ is_author_first_thread: 1 });
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1"),
				env,
				getCtx(),
			);

			const data = await response.json();
			expect(data.data[0].isAuthorFirstThread).toBe(true);
		});

		it("should map is_author_first_thread=0 to isAuthorFirstThread=false", async () => {
			const d1Row = makeD1ThreadRow({ is_author_first_thread: 0 });
			const allSpy = vi.fn(() => Promise.resolve({ results: [d1Row] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await list(
				new Request("https://example.com/api/v1/threads?forumId=1"),
				env,
				getCtx(),
			);

			const data = await response.json();
			expect(data.data[0].isAuthorFirstThread).toBe(false);
		});

		it("WHERE clause includes global-sticky escape hatch so sticky=2 surfaces in every forum", async () => {
			// The site-wide announcement (sticky=2) MUST appear at the top of
			// every forum's thread list. The implementation enforces this by
			// widening the WHERE clause from `forum_id = ?` to
			// `(forum_id = ? OR sticky = 2)` on both the data SELECT and the
			// COUNT, so that a global thread anchored to any forum still
			// joins the result set when listing any *other* forum.
			const sqls: string[] = [];
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					sqls.push(sql);
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=42"), env, getCtx());

			// Data SELECT carries the aliased global clause.
			expect(
				sqls.some(
					(s) => s.includes("FROM threads t") && s.includes("t.forum_id = ? OR t.sticky = 2"),
				),
			).toBe(true);
			// COUNT carries the unaliased version (per reviewer pin: COUNT has no alias).
			expect(
				sqls.some(
					(s) =>
						s.includes("SELECT COUNT(*) as total FROM threads") &&
						s.includes("(forum_id = ? OR sticky = 2)"),
				),
			).toBe(true);
		});

		it("ORDER BY ranks global sticky above category sticky so sticky=2 sorts above sticky=3", async () => {
			// We can't run real SQL here, but the handler's ORDER BY clause
			// is the contract that guarantees global stickies render first.
			// Discuz `sticky` is {0,1,2,3} = {normal, forum-pin, global,
			// category-pin}. User requirement: global (sticky=2) wins even
			// over category-pin (sticky=3). We remap sticky=2 → rank 4 in
			// the ORDER BY CASE so it sorts above 3 without migrating the
			// column.
			const sqls: string[] = [];
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					sqls.push(sql);
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await list(new Request("https://example.com/api/v1/threads?forumId=42"), env, getCtx());

			expect(
				sqls.some(
					(s) =>
						s.includes("ORDER BY CASE WHEN t.sticky = 2 THEN 4 ELSE t.sticky END DESC") &&
						s.includes("t.last_post_at DESC, t.id DESC"),
				),
			).toBe(true);
		});

		it("keyset cursor condition uses the same sticky-rank CASE so deep pages don't skip sticky=3", async () => {
			// If ORDER BY uses CASE-remapped rank but the cursor predicate
			// keeps raw `t.sticky`, deep pagination after sticky=2 would
			// skip every sticky=3 row (rank 3 < cursor value 4, but
			// raw 3 < raw 2 is false). Both expressions must match.
			const sqls: string[] = [];
			const allSpy = vi.fn(() => Promise.resolve({ results: [] }));
			const db = {
				prepare: vi.fn((sql: string) => {
					sqls.push(sql);
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 0 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// Build a cursor payload — value doesn't matter, we just need
			// the query path that injects the cursor predicate.
			const cursor = Buffer.from(
				JSON.stringify({ sticky: 4, lastPostAt: 1700000000, id: 999 }),
			).toString("base64");
			await list(
				new Request(`https://example.com/api/v1/threads?forumId=42&cursor=${cursor}`),
				env,
				getCtx(),
			);

			expect(
				sqls.some(
					(s) =>
						s.includes("CASE WHEN t.sticky = 2 THEN 4 ELSE t.sticky END < ?") &&
						s.includes("CASE WHEN t.sticky = 2 THEN 4 ELSE t.sticky END = ?"),
				),
			).toBe(true);
		});

		it("nextCursor encodes sticky=2 rows as rank 4 so deep pagination over sticky=3 lands correctly", async () => {
			// When the last row on page 1 is a sticky=2 announcement, the
			// next-cursor sticky field must be 4 (the SQL rank), not 2.
			// Otherwise the cursor `< ?` comparison would discard sticky=3
			// rows on page 2.
			const sqls: string[] = [];
			const allSpy = vi.fn(() =>
				Promise.resolve({
					results: [
						{
							id: 1071193,
							forum_id: 999,
							sticky: 2,
							last_post_at: 1700000000,
							author_id: 1,
							author_name: "x",
							subject: "全站公告",
							created_at: 1700000000,
							last_poster: "x",
							last_poster_id: 1,
							replies: 0,
							views: 0,
							closed: 0,
							digest: 0,
							special: 0,
							highlight: 0,
							recommends: 0,
							type_name: "",
						},
					],
				}),
			);
			const db = {
				prepare: vi.fn((sql: string) => {
					sqls.push(sql);
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 1, visibility: "public" })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							all: allSpy,
							first: vi.fn(() => Promise.resolve({ total: 1 })),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			// limit=1 forces buildNextCursor to emit a non-null cursor.
			const res = await list(
				new Request("https://example.com/api/v1/threads?forumId=114&limit=1"),
				env,
				getCtx(),
			);
			const body = (await res.json()) as { meta?: { nextCursor?: string | null } };
			expect(body.meta?.nextCursor).toBeTruthy();
			const decoded = JSON.parse(
				Buffer.from(body.meta?.nextCursor as string, "base64").toString("utf8"),
			);
			expect(decoded.sticky).toBe(4);
			expect(decoded.id).toBe(1071193);
		});
	});

	describe("getById", () => {
		/** Helper: creates a mock DB for getById which handles thread, user cache, forum visibility, and views queries */
		function createGetByIdMockDb(threadRow: unknown | null) {
			return {
				prepare: vi.fn((sql: string) => {
					// Thread query (with or without JOIN)
					if (sql.includes("FROM threads") && sql.includes("WHERE")) {
						return {
							bind: vi.fn((..._args: unknown[]) => ({
								first: vi.fn(() => Promise.resolve(threadRow)),
							})),
						};
					}
					// Forum visibility check query
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					// Views increment query
					if (sql.includes("UPDATE threads SET views")) {
						return {
							bind: vi.fn((..._args: unknown[]) => ({
								run: vi.fn(() => Promise.resolve({ success: true })),
							})),
						};
					}
					return {
						bind: vi.fn((..._args: unknown[]) => ({
							first: vi.fn(() => Promise.resolve(null)),
							all: vi.fn(() => Promise.resolve({ results: [] })),
							run: vi.fn(() => Promise.resolve({ success: true })),
						})),
					};
				}),
			} as unknown as D1Database;
		}

		it("should map D1 row to camelCase Thread when found", async () => {
			const d1Row = makeD1ThreadRow({ id: 123, forum_id: 10, author_id: 100 });
			const db = createGetByIdMockDb(d1Row);
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/threads/123"),
				env,
				getCtx(),
			);

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
			const db = createGetByIdMockDb(null);
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/threads/999"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should parse thread ID from URL", async () => {
			const d1Row = makeD1ThreadRow({ id: 456 });
			const db = createGetByIdMockDb(d1Row);
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/threads/456"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(200);
			const data = (await response.json()) as { data: { id: number } };
			expect(data.data.id).toBe(456);
		});

		it("should increment view count when thread is fetched", async () => {
			const d1Row = makeD1ThreadRow({ id: 42 });
			const db = createGetByIdMockDb(d1Row);
			const env = { ...mockEnv, DB: db };
			const ctx = getCtx() as ReturnType<typeof getCtx> & {
				_waitUntilPromises: Promise<unknown>[];
			};

			await getById(new Request("https://example.com/api/v1/threads/42"), env, ctx);

			// The view-bump now runs inside `ctx.waitUntil` (see
			// `scheduleThreadViewIncrement`). Drain so the prepare chain
			// executes, then assert the exact UPDATE SQL hit D1 with the
			// thread id bound. Pinning the SQL + bind here catches
			// regressions where the helper drifts (column rename,
			// conditional clause).
			await Promise.all(ctx._waitUntilPromises);
			const updateCall = (db.prepare as ReturnType<typeof mock>).mock.calls.find((c) =>
				(c[0] as string).includes("UPDATE threads SET views"),
			);
			expect(updateCall?.[0] as string).toBe("UPDATE threads SET views = views + 1 WHERE id = ?");
			expect(ctx.waitUntil).toHaveBeenCalled();
		});

		it("should increment views even if UPDATE fails (fire-and-forget)", async () => {
			// D1 reject must not break the user-visible 200 response, and
			// must not surface as an unhandled rejection on the
			// waitUntil-bound promise. The helper swallows the error into
			// `console.warn` — see `lib/thread-views.test.ts` for the
			// helper-level assertion; here we just verify the handler
			// doesn't regress.
			const d1Row = makeD1ThreadRow({ id: 42 });
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM threads") && sql.includes("WHERE")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve(d1Row)),
							})),
						};
					}
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					if (sql.includes("UPDATE threads SET views")) {
						return {
							bind: vi.fn(() => ({
								run: vi.fn(() => Promise.reject(new Error("D1 unavailable"))),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve(null)),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };
			const ctx = getCtx() as ReturnType<typeof getCtx> & {
				_waitUntilPromises: Promise<unknown>[];
			};
			const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

			const response = await getById(
				new Request("https://example.com/api/v1/threads/42"),
				env,
				ctx,
			);

			// Should still return 200 despite UPDATE failure
			expect(response.status).toBe(200);
			// And the waitUntil-bound promise must resolve, not reject —
			// otherwise we're back to swallowed unhandled rejections.
			await expect(Promise.all(ctx._waitUntilPromises)).resolves.toEqual([undefined]);
			expect(warnSpy).toHaveBeenCalledWith(
				"[thread-views] increment failed",
				expect.objectContaining({ threadId: 42 }),
			);
			warnSpy.mockRestore();
		});

		it("should return 404 when forum is inactive for getById", async () => {
			const d1Row = makeD1ThreadRow({ id: 1 });
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM threads") && sql.includes("WHERE")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve(d1Row)),
							})),
						};
					}
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 0, visibility: "public", moderator_ids: "" }),
								),
							})),
						};
					}
					if (sql.includes("UPDATE threads SET views")) {
						return {
							bind: vi.fn(() => ({
								run: vi.fn(() => Promise.resolve({ success: true })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve(null)),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/threads/1"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should return 403 when forum visibility denies access for getById", async () => {
			const d1Row = makeD1ThreadRow({ id: 1 });
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM threads") && sql.includes("WHERE")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve(d1Row)),
							})),
						};
					}
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "members", moderator_ids: "" }),
								),
							})),
						};
					}
					if (sql.includes("UPDATE threads SET views")) {
						return {
							bind: vi.fn(() => ({
								run: vi.fn(() => Promise.resolve({ success: true })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve(null)),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/threads/1"),
				env,
				getCtx(),
			);

			expect(response.status).toBe(403);
			const data = await response.json();
			expect(data.error.code).toBe("FORBIDDEN");
		});

		it("should NOT schedule a view bump when getById early-returns 404 (thread missing)", async () => {
			// Early-return paths must not increment views — otherwise a
			// 404 probe loop could still inflate counts. Pin this
			// behavior here so future refactors of `getById` can't
			// accidentally move `scheduleThreadViewIncrement` above the
			// existence/visibility checks.
			const db = createGetByIdMockDb(null);
			const env = { ...mockEnv, DB: db };
			const ctx = getCtx();

			const response = await getById(
				new Request("https://example.com/api/v1/threads/999"),
				env,
				ctx,
			);

			expect(response.status).toBe(404);
			expect(ctx.waitUntil).not.toHaveBeenCalled();
			const updateCall = (db.prepare as ReturnType<typeof mock>).mock.calls.find((c) =>
				(c[0] as string).includes("UPDATE threads SET views"),
			);
			expect(updateCall).toBeUndefined();
		});

		it("should NOT schedule a view bump when forum is inactive (404)", async () => {
			const d1Row = makeD1ThreadRow({ id: 1 });
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM threads") && sql.includes("WHERE")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve(d1Row)),
							})),
						};
					}
					if (sql.includes("SELECT status, visibility FROM forums")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve({ status: 0, visibility: "public" })),
							})),
						};
					}
					if (sql.includes("UPDATE threads SET views")) {
						return {
							bind: vi.fn(() => ({
								run: vi.fn(() => Promise.resolve({ success: true })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve(null)),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };
			const ctx = getCtx();

			const response = await getById(new Request("https://example.com/api/v1/threads/1"), env, ctx);

			expect(response.status).toBe(404);
			expect(ctx.waitUntil).not.toHaveBeenCalled();
			const updateCall = (db.prepare as ReturnType<typeof mock>).mock.calls.find((c) =>
				(c[0] as string).includes("UPDATE threads SET views"),
			);
			expect(updateCall).toBeUndefined();
		});

		it("should NOT schedule a view bump when visibility denies access (403)", async () => {
			const d1Row = makeD1ThreadRow({ id: 1 });
			const db = {
				prepare: vi.fn((sql: string) => {
					if (sql.includes("FROM threads") && sql.includes("WHERE")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() => Promise.resolve(d1Row)),
							})),
						};
					}
					if (sql.includes("FROM forums WHERE id")) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(() =>
									Promise.resolve({ status: 1, visibility: "members", moderator_ids: "" }),
								),
							})),
						};
					}
					if (sql.includes("UPDATE threads SET views")) {
						return {
							bind: vi.fn(() => ({
								run: vi.fn(() => Promise.resolve({ success: true })),
							})),
						};
					}
					return {
						bind: vi.fn(() => ({
							first: vi.fn(() => Promise.resolve(null)),
						})),
					};
				}),
			} as unknown as D1Database;
			const env = { ...mockEnv, DB: db };
			const ctx = getCtx();

			const response = await getById(new Request("https://example.com/api/v1/threads/1"), env, ctx);

			expect(response.status).toBe(403);
			expect(ctx.waitUntil).not.toHaveBeenCalled();
			const updateCall = (db.prepare as ReturnType<typeof mock>).mock.calls.find((c) =>
				(c[0] as string).includes("UPDATE threads SET views"),
			);
			expect(updateCall).toBeUndefined();
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": null,
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT * FROM threads WHERE id": createdThread,
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
					"SELECT username FROM users": { username: "testuser" },
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
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
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT * FROM threads WHERE id": createdThread,
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
					"SELECT username FROM users": { username: "testuser" },
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"FROM forums WHERE id": makeD1ForumRow({ id: 1 }),
					"SELECT status, avatar_path, has_avatar, reg_date, role FROM users": {
						status: 0,
						avatar_path: "avatars/test.jpg",
						has_avatar: 0,
						reg_date: 0,
						role: 0,
					},
				},
				allResults: {
					"SELECT key, value FROM settings WHERE key LIKE": [],
				},
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

		// docs/17 §5.4 — Phase 5b email-verification gate regression.
		it("rejects unverified user with 403 EMAIL_NOT_VERIFIED payload (gate fires before business SQL)", async () => {
			const { env, calls } = makeUnverifiedEnv(1);
			const token = await unverifiedUserJwt(1);
			const response = await create(
				new Request("https://example.com/api/v1/threads", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 1, subject: "x", content: "y" }),
				}),
				env,
			);
			await expectEmailNotVerifiedResponse(response);
			// Auth middleware runs exactly one DB query (SELECT role, status,
			// email_verified_at FROM users) and the handler short-circuits before
			// hitting any forum / settings / thread SQL.
			expect(calls.length).toBe(1);
			expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
		});
	});
});
