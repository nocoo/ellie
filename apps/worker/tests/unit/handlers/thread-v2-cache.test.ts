// Tests for the v2 thread-list page1 cache wired into thread.ts:list.
// Covers reviewer-required invariants from Phase 3 design v2:
//   - page1 cache MISS writes a `thread:list:v2:*` envelope and serves data
//   - page1 cache HIT serves from KV without re-running the threads SELECT
//   - deep pagination (cursor / page>1) NEVER touches `thread:list:v2:*`
//   - non-cacheable limit buckets NEVER touch `thread:list:v2:*`
//   - 404 / 403 from `forum:meta:v2` NEVER write `thread:list:v2:*`
//   - response wire shape (paginated vs. listResponse) is preserved
//   - cursor in keyset miss path is built from raw D1 row, not mapped Thread

import { beforeEach, describe, expect, it, vi } from "vitest";
import { list } from "../../../src/handlers/thread";
import {
	THREAD_LIST_LIMIT_BUCKETS,
	THREAD_LIST_TTL,
	isCacheableLimit,
	isPage1,
	isThreadListPayload,
} from "../../../src/lib/cache/thread-list-read";
import { createMockCtx, createMockKV, makeD1ThreadRow, makeEnv } from "../../helpers";

vi.mock("../../../src/middleware/auth", () => ({
	optionalAuthVerified: vi.fn(async () => null),
}));
import { optionalAuthVerified } from "../../../src/middleware/auth";
const mockAuth = optionalAuthVerified as ReturnType<typeof vi.fn>;

// ─── Helpers ────────────────────────────────────────────────────────

interface ThreadCacheTestState {
	prepareSpy: ReturnType<typeof vi.fn>;
	threadSelectCalls: number;
}

/**
 * D1 mock tailored for thread.ts:list tests. Routes by SQL prefix:
 *   - `SELECT * FROM forums WHERE id = ?` → forum row (for forum:meta v2 miss
 *     loader)
 *   - `SELECT COUNT(*) … FROM threads …` → count for offset branch
 *   - `SELECT * FROM threads …` / `SELECT t.*, …` → the thread page rows
 *   - `SELECT … FROM users` etc. → moderator/visible-last/today-count fan-out
 *     used by `loadFullForumFromD1` on a forum:meta MISS
 *
 * `threadSelectCalls` only counts the actual thread page SELECT, which is the
 * call we expect to disappear on a page1 cache HIT.
 */
function makeD1Mock(opts: {
	forumRow?: Record<string, unknown> | null;
	threadRows?: Record<string, unknown>[];
	totalThreads?: number;
}): { db: D1Database; state: ThreadCacheTestState } {
	const state: ThreadCacheTestState = {
		prepareSpy: vi.fn(),
		threadSelectCalls: 0,
	};
	const forumRow =
		opts.forumRow === undefined
			? {
					id: 1,
					status: 1,
					visibility: "public",
					name: "F",
					description: "",
					icon: "",
					display_order: 1,
					threads: 0,
					posts: 0,
					type: "forum",
					moderators: "",
					moderator_ids: "",
					last_thread_id: 0,
					last_post_at: 0,
					last_poster: "",
					last_poster_id: 0,
					last_thread_subject: "",
					parent_id: 0,
				}
			: opts.forumRow;
	const threadRows = opts.threadRows ?? [];
	const totalThreads = opts.totalThreads ?? threadRows.length;

	const db = {
		prepare: vi.fn((sql: string) => {
			state.prepareSpy(sql);
			const isThreadPageSelect =
				/FROM threads/i.test(sql) && /ORDER BY/i.test(sql) && /LIMIT \?/i.test(sql);
			if (isThreadPageSelect) state.threadSelectCalls++;

			const stmt = {
				bind: vi.fn(() => stmt),
				first: vi.fn(async () => {
					if (/SELECT \* FROM forums WHERE id = \?/.test(sql)) return forumRow;
					if (/SELECT COUNT\(\*\)/i.test(sql) && /FROM threads/i.test(sql))
						return { total: totalThreads };
					return null;
				}),
				all: vi.fn(async () => {
					if (isThreadPageSelect) return { results: threadRows };
					// Fan-outs used by loadFullForumFromD1 (visible-last-thread,
					// moderator names, today-thread count, users join). All return
					// empty so the snapshot builder produces a benign payload.
					return { results: [] };
				}),
				run: vi.fn(async () => ({ success: true, meta: { last_row_id: 0, changes: 0 } })),
			} as unknown as D1PreparedStatement;
			return stmt;
		}),
	} as unknown as D1Database;
	return { db, state };
}

function makeReq(qs: string): Request {
	return new Request(`https://api.example.com/api/v1/threads?${qs}`);
}

beforeEach(() => {
	mockAuth.mockReset();
	mockAuth.mockResolvedValue(null);
});

// ─── Pure helpers ───────────────────────────────────────────────────

describe("cache/thread-list-read — pure helpers", () => {
	it("THREAD_LIST_LIMIT_BUCKETS locks the canonical 20|50|100 set", () => {
		expect([...THREAD_LIST_LIMIT_BUCKETS]).toEqual([20, 50, 100]);
	});

	it("THREAD_LIST_TTL is 60s (short — correctness comes from gen bumps)", () => {
		expect(THREAD_LIST_TTL).toBe(60);
	});

	it("isCacheableLimit accepts only the three buckets", () => {
		expect(isCacheableLimit(20)).toBe(true);
		expect(isCacheableLimit(50)).toBe(true);
		expect(isCacheableLimit(100)).toBe(true);
		expect(isCacheableLimit(10)).toBe(false);
		expect(isCacheableLimit(25)).toBe(false);
		expect(isCacheableLimit(101)).toBe(false);
	});

	it("isPage1: keyset (no cursor) is page1", () => {
		expect(isPage1(null, null)).toBe(true);
		expect(isPage1("", null)).toBe(true);
	});

	it("isPage1: offset page=1 is page1, page>1 is not", () => {
		expect(isPage1(null, "1")).toBe(true);
		expect(isPage1(null, "2")).toBe(false);
		expect(isPage1(null, "10")).toBe(false);
	});

	it("isPage1: any cursor is NOT page1", () => {
		expect(isPage1("anycursor", null)).toBe(false);
		expect(isPage1("anycursor", "1")).toBe(false);
	});

	it("isThreadListPayload accepts the canonical envelope", () => {
		expect(isThreadListPayload({ items: [], total: 0, nextCursor: null, limit: 20 })).toBe(true);
		expect(isThreadListPayload({ items: [], total: 5, nextCursor: "abc", limit: 50 })).toBe(true);
	});

	it("isThreadListPayload rejects schema drift (missing or wrong-typed fields)", () => {
		expect(isThreadListPayload(null)).toBe(false);
		expect(isThreadListPayload({})).toBe(false);
		expect(isThreadListPayload({ items: [], limit: 20 })).toBe(false);
		expect(isThreadListPayload({ items: "no", total: 0, nextCursor: null, limit: 20 })).toBe(false);
		expect(isThreadListPayload({ items: [], total: "no", nextCursor: null, limit: 20 })).toBe(
			false,
		);
		// Pre-9d39588 envelope where keyset miss wrote `total: null` —
		// MUST be rejected so cache rebuilds on first read after deploy.
		expect(isThreadListPayload({ items: [], total: null, nextCursor: "abc", limit: 50 })).toBe(
			false,
		);
		expect(isThreadListPayload({ items: [], total: 0, nextCursor: 5, limit: 20 })).toBe(false);
		expect(isThreadListPayload({ items: [], total: 0, nextCursor: null, limit: "20" })).toBe(false);
	});
});

// ─── Integration: handler + cache wiring ────────────────────────────

describe("handlers/thread.list — page1 KV cache wiring", () => {
	function getThreadListKeys(kv: KVNamespace): string[] {
		const writes = (kv.put as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		return writes.filter((k) => k.startsWith("thread:list:v2:"));
	}

	function getThreadListReads(kv: KVNamespace): string[] {
		const reads = (kv.get as ReturnType<typeof vi.fn>).mock.calls.map(
			(c: unknown[]) => c[0] as string,
		);
		return reads.filter((k) => k.startsWith("thread:list:v2:"));
	}

	it("page1 keyset MISS: writes thread:list:v2 envelope with TTL 60", async () => {
		const { db } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 }), makeD1ThreadRow({ id: 12 })],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(makeReq("forumId=1&limit=20"), env, ctx);
		expect(res.status).toBe(200);
		// Drain waitUntil so KV write-back lands.
		await Promise.all(ctx._waitUntilPromises);

		const written = getThreadListKeys(kv);
		expect(written.length).toBe(1);
		expect(written[0]).toMatch(/^thread:list:v2:1:default:20:p1:gf.+:ga.+$/);

		const writeArgs = (kv.put as ReturnType<typeof vi.fn>).mock.calls.find((c: unknown[]) =>
			(c[0] as string).startsWith("thread:list:v2:"),
		);
		const opts = writeArgs?.[2] as { expirationTtl: number } | undefined;
		expect(opts?.expirationTtl).toBe(THREAD_LIST_TTL);
	});

	it("page1 keyset HIT: zero thread page SELECTs", async () => {
		const { db, state } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 })],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });

		// First request populates cache + gens.
		const ctx1 = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		await list(makeReq("forumId=1&limit=20"), env, ctx1);
		await Promise.all(ctx1._waitUntilPromises);
		expect(state.threadSelectCalls).toBe(1);

		// Second request: gens are warm, payload is cached → handler must NOT
		// re-run the thread page SELECT.
		const ctx2 = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const res = await list(makeReq("forumId=1&limit=20"), env, ctx2);
		expect(res.status).toBe(200);
		expect(state.threadSelectCalls).toBe(1);

		const body = (await res.json()) as { data?: unknown[]; nextCursor?: string | null };
		expect(Array.isArray(body.data)).toBe(true);
	});

	it("offset page=1 MISS: writes thread:list:v2 and response stays paginatedResponse", async () => {
		const { db } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 })],
			totalThreads: 1,
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(makeReq("forumId=1&page=1&limit=50"), env, ctx);
		expect(res.status).toBe(200);
		await Promise.all(ctx._waitUntilPromises);

		const body = (await res.json()) as { data?: unknown[]; meta?: Record<string, unknown> };
		// paginatedResponse shape: data + meta.{total,page,limit,pages}.
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.meta).toMatchObject({ total: 1, page: 1, limit: 50 });

		const written = getThreadListKeys(kv);
		expect(written.length).toBe(1);
		expect(written[0]).toMatch(/^thread:list:v2:1:default:50:p1:gf.+:ga.+$/);
	});

	it("offset page>1: NEVER touches thread:list:v2", async () => {
		const { db } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 })],
			totalThreads: 1,
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(makeReq("forumId=1&page=2&limit=20"), env, ctx);
		expect(res.status).toBe(200);
		await Promise.all(ctx._waitUntilPromises);

		expect(getThreadListReads(kv)).toEqual([]);
		expect(getThreadListKeys(kv)).toEqual([]);
	});

	it("keyset with cursor: NEVER touches thread:list:v2", async () => {
		const { db } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 })],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		// The cursor decoding will fail and yield null cursor → handler treats
		// this as page1; instead we use a syntactically valid base64 but the
		// presence of `cursor=` is enough to mark it as deep pagination per
		// `isPage1`. We use a clearly non-empty value so isPage1 returns false.
		const res = await list(makeReq("forumId=1&cursor=NOT_PAGE_ONE&limit=20"), env, ctx);
		expect(res.status).toBe(200);
		await Promise.all(ctx._waitUntilPromises);

		expect(getThreadListReads(kv)).toEqual([]);
		expect(getThreadListKeys(kv)).toEqual([]);
	});

	it("non-cacheable limit (e.g. 25): NEVER touches thread:list:v2", async () => {
		const { db } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 })],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(makeReq("forumId=1&limit=25"), env, ctx);
		expect(res.status).toBe(200);
		await Promise.all(ctx._waitUntilPromises);

		expect(getThreadListReads(kv)).toEqual([]);
		expect(getThreadListKeys(kv)).toEqual([]);
	});

	it("forum 404 (forum:meta MISS → notFound): NEVER writes thread:list:v2", async () => {
		const { db } = makeD1Mock({ forumRow: null });
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(makeReq("forumId=99&limit=20"), env, ctx);
		expect(res.status).toBe(404);
		await Promise.all(ctx._waitUntilPromises);

		expect(getThreadListKeys(kv)).toEqual([]);
	});

	it("forum 403 (visibility forbidden): NEVER writes thread:list:v2", async () => {
		// Forum exists but is staff-only; anonymous viewer hits 403.
		const { db } = makeD1Mock({
			forumRow: {
				id: 1,
				status: 1,
				visibility: "staff",
				name: "F",
				description: "",
				icon: "",
				display_order: 1,
				threads: 0,
				posts: 0,
				type: "forum",
				moderators: "",
				moderator_ids: "",
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
				last_poster_id: 0,
				last_thread_subject: "",
				parent_id: 0,
			},
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };

		const res = await list(makeReq("forumId=1&limit=20"), env, ctx);
		expect(res.status).toBe(403);
		await Promise.all(ctx._waitUntilPromises);

		expect(getThreadListKeys(kv)).toEqual([]);
	});

	// ─── Cross-shape page1 cache contract ───────────────────────────
	// Both keyset (no cursor) and offset (page=1) page1 requests share the
	// SAME `thread:list:v2` cache key. Whichever shape warms the cache
	// first must produce a payload that the OTHER shape can read back
	// without losing `meta.total` or `nextCursor`.

	it("keyset warms → offset page=1 hit: meta.total/page/limit/pages stay correct, no extra thread SELECT", async () => {
		const { db, state } = makeD1Mock({
			threadRows: [makeD1ThreadRow({ id: 11 }), makeD1ThreadRow({ id: 12 })],
			totalThreads: 2,
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });

		// 1) Keyset request warms the cache.
		const ctx1 = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const r1 = await list(makeReq("forumId=1&limit=20"), env, ctx1);
		expect(r1.status).toBe(200);
		await Promise.all(ctx1._waitUntilPromises);
		const selectsAfterWarm = state.threadSelectCalls;
		expect(selectsAfterWarm).toBe(1);

		// 2) Offset page=1 request hits the SAME cache key.
		const ctx2 = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const r2 = await list(makeReq("forumId=1&page=1&limit=20"), env, ctx2);
		expect(r2.status).toBe(200);
		const body = (await r2.json()) as { data?: unknown[]; meta?: Record<string, unknown> };
		expect(Array.isArray(body.data)).toBe(true);
		// total MUST come back as 2 (not 0 / null) — proves keyset-warmed
		// payload still carries the COUNT result.
		expect(body.meta).toMatchObject({ total: 2, page: 1, limit: 20, pages: 1 });
		// And we must NOT have issued another thread page SELECT.
		expect(state.threadSelectCalls).toBe(selectsAfterWarm);
	});

	it("offset page=1 warms → keyset hit: nextCursor stays non-null when limit is full", async () => {
		// Fill exactly `limit` rows so buildNextCursor produces a real cursor.
		const limit = 20;
		const rows = Array.from({ length: limit }, (_, i) => makeD1ThreadRow({ id: 100 + i }));
		const { db, state } = makeD1Mock({ threadRows: rows, totalThreads: 200 });
		const kv = createMockKV();
		const env = makeEnv({ DB: db, KV: kv });

		// 1) Offset page=1 request warms the cache.
		const ctx1 = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const r1 = await list(makeReq(`forumId=1&page=1&limit=${limit}`), env, ctx1);
		expect(r1.status).toBe(200);
		await Promise.all(ctx1._waitUntilPromises);
		const selectsAfterWarm = state.threadSelectCalls;
		expect(selectsAfterWarm).toBe(1);

		// 2) Keyset (no cursor) request hits the SAME cache key.
		const ctx2 = createMockCtx() as ExecutionContext & { _waitUntilPromises: Promise<unknown>[] };
		const r2 = await list(makeReq(`forumId=1&limit=${limit}`), env, ctx2);
		expect(r2.status).toBe(200);
		const body = (await r2.json()) as {
			data?: unknown[];
			meta?: { nextCursor?: string | null };
		};
		expect(Array.isArray(body.data)).toBe(true);
		// nextCursor MUST be a non-empty string — proves offset-warmed
		// payload still carries the keyset cursor derived from raw rows.
		const nc = body.meta?.nextCursor;
		expect(typeof nc).toBe("string");
		expect((nc as string).length).toBeGreaterThan(0);
		// No additional thread page SELECT on the keyset hit.
		expect(state.threadSelectCalls).toBe(selectsAfterWarm);
	});
});
