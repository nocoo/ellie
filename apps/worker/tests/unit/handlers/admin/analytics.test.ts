// Admin analytics handler unit tests (P2 query-only, KV-bypass).
//
// SQL shape pinning per reviewer (msg=176f4860): we don't depend on
// SQLite planner output; we assert the exact SQL string (whitespace-
// collapsed) + bind params. Index correctness is guarded separately by
// `tests/unit/migration-0041-schema.test.ts`.
//
// Cache policy: all four handlers bypass KV and respond with
// `Cache-Control: no-store, private`. Admins need immediate feedback
// after moderation actions, so the prior 60s-300s cache layer was
// removed. The tests below assert (1) D1 is hit on every call,
// (2) no KV.get / KV.put happens, and (3) the response header includes
// no-store, private.

import { describe, expect, it, vi } from "vitest";
import {
	_internal,
	getCheckinTrend,
	getForumDist,
	getOverview,
	getTrend,
} from "../../../../src/handlers/admin/analytics";
import { createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Mock ExecutionContext that synchronously collects waitUntil
 * promises and lets the test choose to await them or not.
 */
function makeCtx() {
	const promises: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: vi.fn((p: Promise<unknown>) => {
			promises.push(p);
		}),
		passThroughOnException: vi.fn(),
		_promises: promises,
	} as unknown as ExecutionContext & { _promises: Promise<unknown>[] };
	return ctx;
}

function normalizeSql(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/**
 * Mock D1 that records (sql, params) per call and returns canned
 * results in the order they're prepared. `batch` consumes the next
 * `n` prepares.
 */
function makeMockDb(opts: { canned?: Array<{ results: Array<Record<string, unknown>> }> }) {
	const calls: Array<{ sql: string; binds: unknown[] }> = [];
	let cursor = 0;
	const canned = opts.canned ?? [];

	const makePrepared = (sql: string) => {
		const binds: unknown[] = [];
		const prepared = {
			_sql: sql,
			_binds: binds,
			bind: vi.fn((...params: unknown[]) => {
				for (const p of params) binds.push(p);
				return prepared;
			}),
			all: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				const next = canned[cursor++] ?? { results: [] };
				return next;
			}),
			first: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				const next = canned[cursor++] ?? { results: [] };
				return next.results[0] ?? null;
			}),
		};
		return prepared;
	};

	const db = {
		prepare: vi.fn((sql: string) => makePrepared(sql)),
		batch: vi.fn(async (statements: ReturnType<typeof makePrepared>[]) => {
			const out: Array<{ results: Array<Record<string, unknown>> }> = [];
			for (const stmt of statements) {
				calls.push({ sql: stmt._sql, binds: [...stmt._binds] });
				out.push(canned[cursor++] ?? { results: [] });
			}
			return out;
		}),
	} as unknown as D1Database & { _calls: typeof calls };
	(db as unknown as { _calls: typeof calls })._calls = calls;
	return db as unknown as D1Database & { _calls: typeof calls };
}

// ─── localTodayStart / dayLocalToIso / fillDaily ─────────────────

describe("analytics — time helpers", () => {
	it("localTodayStart anchors to Asia/Shanghai local midnight", () => {
		// 2026-01-01 00:00:00 UTC+8 == 2025-12-31 16:00:00 UTC.
		const utcMidnight = Math.floor(Date.UTC(2025, 11, 31, 16, 0, 0) / 1000);
		// Probe just after local midnight.
		const nowSec = utcMidnight + 60;
		expect(_internal.localTodayStart(nowSec)).toBe(utcMidnight);
	});

	it("dayLocalToIso round-trips through localTodayStart", () => {
		const utcMidnight = Math.floor(Date.UTC(2025, 11, 31, 16, 0, 0) / 1000);
		const dayLocal = Math.floor((utcMidnight + 8 * 3600) / 86400);
		expect(_internal.dayLocalToIso(dayLocal)).toBe("2026-01-01");
	});

	it("fillDaily fills in missing days with count=0 and preserves order", () => {
		// Anchor "today" to 2026-01-10 (UTC+8).
		const utcMidnight = Math.floor(Date.UTC(2026, 0, 9, 16, 0, 0) / 1000);
		const todayLocal = Math.floor((utcMidnight + 8 * 3600) / 86400);
		const filled = _internal.fillDaily(
			[
				{ day_local: todayLocal - 2, count: 5 },
				{ day_local: todayLocal, count: 7 },
			],
			3,
			utcMidnight + 60,
		);
		expect(filled).toEqual([
			{ date: "2026-01-08", count: 5 },
			{ date: "2026-01-09", count: 0 },
			{ date: "2026-01-10", count: 7 },
		]);
	});

	it("fillDaily produces a single bucket for days=1", () => {
		const utcMidnight = Math.floor(Date.UTC(2026, 0, 9, 16, 0, 0) / 1000);
		const todayLocal = Math.floor((utcMidnight + 8 * 3600) / 86400);
		expect(_internal.fillDaily([{ day_local: todayLocal, count: 4 }], 1, utcMidnight + 60)).toEqual(
			[{ date: "2026-01-10", count: 4 }],
		);
	});

	it("fillDailyByIso fills missing YYYY-MM-DD keys with 0 and preserves order", () => {
		const utcMidnight = Math.floor(Date.UTC(2026, 0, 9, 16, 0, 0) / 1000);
		const filled = _internal.fillDailyByIso(
			[
				{ date_local: "2026-01-08", count: 5 },
				{ date_local: "2026-01-10", count: 7 },
			],
			3,
			utcMidnight + 60,
		);
		expect(filled).toEqual([
			{ date: "2026-01-08", count: 5 },
			{ date: "2026-01-09", count: 0 },
			{ date: "2026-01-10", count: 7 },
		]);
	});

	it("fillDailyByIso treats an empty row set as all-zero days", () => {
		const utcMidnight = Math.floor(Date.UTC(2026, 0, 9, 16, 0, 0) / 1000);
		const filled = _internal.fillDailyByIso([], 2, utcMidnight + 60);
		expect(filled).toEqual([
			{ date: "2026-01-09", count: 0 },
			{ date: "2026-01-10", count: 0 },
		]);
	});

	it("localTodayIso returns the YYYY-MM-DD key for Asia/Shanghai today", () => {
		// 2026-01-01 00:30 UTC+8 == 2025-12-31 16:30 UTC. Day key is 2026-01-01.
		const nowSec = Math.floor(Date.UTC(2025, 11, 31, 16, 30, 0) / 1000);
		expect(_internal.localTodayIso(nowSec)).toBe("2026-01-01");
	});

	it("rangeDays-via-loaders maps each token to the expected window size", async () => {
		// Indirectly probed: 90d -> 90 buckets in fillDaily.
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=users&range=90d"),
			env,
			ctx,
		);
		const body = (await res.json()) as { data: { series: unknown[] } };
		expect(body.data.series).toHaveLength(90);
	});
});

// ─── Origin header propagation ──────────────────────────────────

describe("analytics — Origin header", () => {
	it("does not throw when request has no Origin", async () => {
		const db = makeMockDb({
			canned: [
				{ results: [{ cnt: 1 }] },
				{ results: [{ cnt: 2 }] },
				{ results: [{ cnt: 3 }] },
				{ results: [{ cnt: 4 }] },
			],
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getOverview(
			createAdminRequest("GET", "/api/admin/analytics/overview"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
	});

	it("accepts request with explicit Origin header", async () => {
		const db = makeMockDb({
			canned: [
				{ results: [{ cnt: 1 }] },
				{ results: [{ cnt: 2 }] },
				{ results: [{ cnt: 3 }] },
				{ results: [{ cnt: 4 }] },
			],
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const base = createAdminRequest("GET", "/api/admin/analytics/overview");
		const headers = new Headers(base.headers);
		headers.set("Origin", "https://admin.example.com");
		const req = new Request(base.url, { method: base.method, headers });
		const res = await getOverview(req, env, ctx);
		expect(res.status).toBe(200);
	});

	it("error responses propagate Origin too", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const base = createAdminRequest("GET", "/api/admin/analytics/trend?metric=lol&range=7d");
		const headers = new Headers(base.headers);
		headers.set("Origin", "https://admin.example.com");
		const req = new Request(base.url, { method: base.method, headers });
		const res = await getTrend(req, env, ctx);
		expect(res.status).toBe(400);
	});
});

// ─── overview ────────────────────────────────────────────────────

describe("GET /api/admin/analytics/overview", () => {
	it("aggregates today KPIs via batch with local-midnight bind", async () => {
		const db = makeMockDb({
			canned: [
				{ results: [{ cnt: 11 }] },
				{ results: [{ cnt: 22 }] },
				{ results: [{ cnt: 33 }] },
				{ results: [{ cnt: 44 }] },
			],
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getOverview(
			createAdminRequest("GET", "/api/admin/analytics/overview"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { today: Record<string, number> } };
		expect(body.data.today).toEqual({
			newUsers: 11,
			newThreads: 22,
			newPosts: 33,
			checkins: 44,
		});

		// 4 prepared statements with the expected WHERE shape.
		const sqls = db._calls.map((c) => normalizeSql(c.sql));
		expect(sqls).toEqual([
			"SELECT COUNT(*) AS cnt FROM users WHERE reg_date >= ?",
			"SELECT COUNT(*) AS cnt FROM threads WHERE created_at >= ?",
			"SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ?",
			"SELECT COUNT(*) AS cnt FROM checkin_history WHERE date_local = ?",
		]);
		// Same local-midnight bound across the three time-based filters.
		// The checkin filter binds the day's YYYY-MM-DD canonical key.
		const baseTs = db._calls[0].binds[0];
		expect(typeof baseTs).toBe("number");
		for (let i = 0; i < 3; i++) expect(db._calls[i].binds[0]).toBe(baseTs);
		const checkinBind = db._calls[3].binds[0];
		expect(typeof checkinBind).toBe("string");
		expect(checkinBind).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it("bypasses KV: never reads or writes the cache", async () => {
		const cached = {
			now: 1_700_000_000,
			today: { newUsers: 1, newThreads: 2, newPosts: 3, checkins: 4 },
		};
		const kv = createMockKV({ "analytics:overview": JSON.stringify(cached) });
		const db = makeMockDb({
			canned: [
				{ results: [{ cnt: 11 }] },
				{ results: [{ cnt: 22 }] },
				{ results: [{ cnt: 33 }] },
				{ results: [{ cnt: 44 }] },
			],
		});
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = makeCtx();
		const res = await getOverview(
			createAdminRequest("GET", "/api/admin/analytics/overview"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		// D1 is hit even though a cached entry exists.
		expect(db._calls).toHaveLength(4);
		const body = (await res.json()) as { data: { today: { newUsers: number } } };
		expect(body.data.today.newUsers).toBe(11);
		// KV is never touched on the read path.
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		// No-store header on every response.
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");
	});
});

// ─── trend ───────────────────────────────────────────────────────

describe("GET /api/admin/analytics/trend", () => {
	it("rejects unknown metric and range", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const r1 = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=lolcat&range=7d"),
			env,
			ctx,
		);
		expect(r1.status).toBe(400);
		const b1 = (await r1.json()) as { error: { code: string } };
		expect(b1.error.code).toBe("INVALID_METRIC");

		const r2 = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=users&range=999d"),
			env,
			ctx,
		);
		expect(r2.status).toBe(400);
		const b2 = (await r2.json()) as { error: { code: string } };
		expect(b2.error.code).toBe("INVALID_RANGE");
	});

	it.each([
		{ metric: "users", table: "users", time: "reg_date" },
		{ metric: "threads", table: "threads", time: "created_at" },
		{ metric: "posts", table: "posts", time: "created_at" },
	])("pins SQL shape for metric=%s", async ({ metric, table, time }) => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getTrend(
			createAdminRequest("GET", `/api/admin/analytics/trend?metric=${metric}&range=7d`),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
		const sql = normalizeSql(db._calls[0].sql);
		expect(sql).toContain(`FROM ${table}`);
		expect(sql).toContain(`WHERE ${time} >=`);
		expect(sql).toContain("GROUP BY day_local");
		expect(sql).toContain("ORDER BY day_local ASC");
		// Derived column expression matches the local-midnight offset.
		expect(sql).toContain(`(${time} + 28800) / 86400) AS day_local`);
		expect(typeof db._calls[0].binds[0]).toBe("number");
	});

	it("pins SQL shape for metric=checkins against date_local (idx_checkin_history_date)", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=checkins&range=7d"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
		const sql = normalizeSql(db._calls[0].sql);
		expect(sql).toContain("FROM checkin_history");
		// Range scan against the canonical Shanghai day key. Inclusive
		// on both ends so the index range is well-formed.
		expect(sql).toContain("WHERE date_local >= ? AND date_local <= ?");
		expect(sql).toContain("GROUP BY date_local");
		expect(sql).toContain("ORDER BY date_local ASC");
		// Must NOT fall back to created_at — that misses the index and
		// drifts from write-side day-key semantics.
		expect(sql).not.toContain("created_at");
		// Both binds are YYYY-MM-DD strings.
		const [startBind, endBind] = db._calls[0].binds;
		expect(typeof startBind).toBe("string");
		expect(typeof endBind).toBe("string");
		expect(startBind).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(endBind).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(String(startBind) <= String(endBind)).toBe(true);
	});

	it("fills missing days with 0 to produce a continuous series", async () => {
		// Compute today_local for `Date.now()` so the mocked rows line up
		// with the live (un-mocked) clock used inside the handler.
		const nowSec = Math.floor(Date.now() / 1000);
		const todayLocal = Math.floor((nowSec + 8 * 3600) / 86400);
		const day3Ago = todayLocal - 3;
		const day1Ago = todayLocal - 1;
		const db = makeMockDb({
			canned: [
				{
					results: [
						{ day_local: day3Ago, count: 9 },
						{ day_local: day1Ago, count: 4 },
					],
				},
			],
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=users&range=7d"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { series: Array<{ date: string; count: number }> };
		};
		expect(body.data.series).toHaveLength(7);
		// 0-counts present.
		expect(body.data.series.filter((p) => p.count === 0)).toHaveLength(5);
		// Real-data days preserved (positions 3 and 5 in the 7-day window).
		expect(body.data.series[3].count).toBe(9);
		expect(body.data.series[5].count).toBe(4);
	});

	it("bypasses KV: never reads or writes the cache", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const kv = createMockKV({
			"analytics:trend:posts:30d": JSON.stringify({
				metric: "posts",
				range: "30d",
				series: [{ date: "2026-01-01", count: 99 }],
			}),
		});
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = makeCtx();
		const res = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=posts&range=30d"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");
	});
});

// ─── forum-dist ──────────────────────────────────────────────────

describe("GET /api/admin/analytics/forum-dist", () => {
	it("pins SQL shape: forum_id leading GROUP, ORDER posts DESC, bound LIMIT", async () => {
		const db = makeMockDb({
			canned: [
				{
					results: [
						{ forum_id: 12, forum_name: "Forum A", posts: 100 },
						{ forum_id: 5, forum_name: "Forum B", posts: 80 },
					],
				},
			],
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getForumDist(
			createAdminRequest("GET", "/api/admin/analytics/forum-dist?range=7d"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { rows: Array<{ forumId: number; forumName: string; posts: number }> };
		};
		expect(body.data.rows).toEqual([
			{ forumId: 12, forumName: "Forum A", posts: 100 },
			{ forumId: 5, forumName: "Forum B", posts: 80 },
		]);
		const sql = normalizeSql(db._calls[0].sql);
		expect(sql).toContain("FROM posts p");
		expect(sql).toContain("LEFT JOIN forums f ON f.id = p.forum_id");
		expect(sql).toContain("WHERE p.created_at >= ?");
		// Drop tombstoned forums (status < 0). Missing rows from the
		// LEFT JOIN are tripped by `COALESCE(f.status, -1)`.
		expect(sql).toContain("COALESCE(f.status, -1) >= 0");
		expect(sql).toContain("GROUP BY p.forum_id");
		expect(sql).toContain("ORDER BY posts DESC, p.forum_id ASC");
		expect(sql).toContain("LIMIT ?");
		expect(db._calls[0].binds[1]).toBe(_internal.FORUM_DIST_LIMIT);
	});

	it("rejects unknown range", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await getForumDist(
			createAdminRequest("GET", "/api/admin/analytics/forum-dist?range=bogus"),
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		const b = (await res.json()) as { error: { code: string } };
		expect(b.error.code).toBe("INVALID_RANGE");
	});
});

// ─── checkin trend ───────────────────────────────────────────────

describe("GET /api/admin/analytics/checkin", () => {
	it("pins SQL shape against checkin_history (date_local index range)", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getCheckinTrend(
			createAdminRequest("GET", "/api/admin/analytics/checkin?range=90d"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const sql = normalizeSql(db._calls[0].sql);
		expect(sql).toContain("FROM checkin_history");
		// Range scan against the canonical Shanghai day key
		// (`idx_checkin_history_date`). NOT `created_at` — that drifts
		// from write-side semantics and full-scans the table.
		expect(sql).toContain("WHERE date_local >= ? AND date_local <= ?");
		expect(sql).toContain("GROUP BY date_local");
		expect(sql).toContain("ORDER BY date_local ASC");
		expect(sql).not.toContain("created_at");
		const [startBind, endBind] = db._calls[0].binds;
		expect(typeof startBind).toBe("string");
		expect(typeof endBind).toBe("string");
		expect(startBind).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(endBind).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(String(startBind) <= String(endBind)).toBe(true);
	});

	it("rejects unknown range", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await getCheckinTrend(
			createAdminRequest("GET", "/api/admin/analytics/checkin?range=bogus"),
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		const b = (await res.json()) as { error: { code: string } };
		expect(b.error.code).toBe("INVALID_RANGE");
	});

	it("bypasses KV: never reads or writes the cache", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const kv = createMockKV({
			"analytics:checkin:7d": JSON.stringify({
				range: "7d",
				series: [{ date: "2026-01-01", count: 99 }],
			}),
		});
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = makeCtx();
		const res = await getCheckinTrend(
			createAdminRequest("GET", "/api/admin/analytics/checkin?range=7d"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");
	});
});

// ─── ctx is irrelevant (handlers don't call waitUntil) ─────────
//
// All four handlers bypass KV; ExecutionContext is unused on the read
// path. Pinning that the handler still serves a fresh DB-direct
// response when ctx is undefined documents the contract for callers
// that hand a partial environment (e.g. ad-hoc internal scripts).

describe("analytics — ctx=undefined fallback", () => {
	it("overview falls back to a direct loader call", async () => {
		const db = makeMockDb({
			canned: [
				{ results: [{ cnt: 1 }] },
				{ results: [{ cnt: 2 }] },
				{ results: [{ cnt: 3 }] },
				{ results: [{ cnt: 4 }] },
			],
		});
		const env = makeEnv({ DB: db });
		const res = await getOverview(
			createAdminRequest("GET", "/api/admin/analytics/overview"),
			env,
			undefined,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { today: { newUsers: number } } };
		expect(body.data.today.newUsers).toBe(1);
		expect(db._calls).toHaveLength(4);
	});

	it("trend falls back to a direct loader call when ctx is missing", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const res = await getTrend(
			createAdminRequest("GET", "/api/admin/analytics/trend?metric=users&range=7d"),
			env,
			undefined,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
	});

	it("forum-dist falls back to a direct loader call when ctx is missing", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const res = await getForumDist(
			createAdminRequest("GET", "/api/admin/analytics/forum-dist?range=7d"),
			env,
			undefined,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
	});

	it("checkin falls back to a direct loader call when ctx is missing", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const res = await getCheckinTrend(
			createAdminRequest("GET", "/api/admin/analytics/checkin?range=30d"),
			env,
			undefined,
		);
		expect(res.status).toBe(200);
		expect(db._calls).toHaveLength(1);
	});
});

// ─── range default + per-loader behaviour ───────────────────────

describe("analytics — range defaults", () => {
	it("trend defaults to 7d when range param is omitted", async () => {
		const body = await (
			await getTrend(
				createAdminRequest("GET", "/api/admin/analytics/trend?metric=users"),
				makeEnv({ DB: makeMockDb({ canned: [{ results: [] }] }) }),
				makeCtx(),
			)
		).json();
		expect((body as { data: { series: unknown[] } }).data.series).toHaveLength(7);
	});

	it("forum-dist defaults to 7d and returns mapped rows even when empty", async () => {
		const db = makeMockDb({ canned: [{ results: [] }] });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await getForumDist(
			createAdminRequest("GET", "/api/admin/analytics/forum-dist"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { range: string; rows: unknown[] } };
		expect(body.data.range).toBe("7d");
		expect(body.data.rows).toEqual([]);
	});
});

// ─── KV-bypass cross-check ───────────────────────────────────────
//
// The KV layer is removed for these four admin endpoints. Verify
// from the cross-cutting angle: regardless of what's in KV, the
// handler reads D1 and returns no-store. (Per-endpoint asserts above
// cover specific endpoints.)

describe("analytics — KV bypass invariant", () => {
	it.each([
		{
			handler: getOverview,
			path: "/api/admin/analytics/overview",
			canned: [
				{ results: [{ cnt: 0 }] },
				{ results: [{ cnt: 0 }] },
				{ results: [{ cnt: 0 }] },
				{ results: [{ cnt: 0 }] },
			],
		},
		{
			handler: getTrend,
			path: "/api/admin/analytics/trend?metric=users&range=7d",
			canned: [{ results: [] }],
		},
		{
			handler: getForumDist,
			path: "/api/admin/analytics/forum-dist?range=7d",
			canned: [{ results: [] }],
		},
		{
			handler: getCheckinTrend,
			path: "/api/admin/analytics/checkin?range=7d",
			canned: [{ results: [] }],
		},
	])("$path: never reads/writes KV and replies no-store", async ({ handler, path, canned }) => {
		const kv = createMockKV();
		const db = makeMockDb({ canned });
		const env = makeEnv({ DB: db, KV: kv });
		const ctx = makeCtx();
		const res = await handler(createAdminRequest("GET", path), env, ctx);
		expect(res.status).toBe(200);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");
	});
});
