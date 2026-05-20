// todayVisits.test.ts — P5 admin "今日访问名单" handler tests.
//
// Coverage:
//   - shanghaiDateLocal(): Asia/Shanghai (UTC+8) day-key formatting.
//   - kpiHandler: KV cache wiring (key + family + TTL), batched D1 read
//     shape (aggregate + per-path_kind breakdown), `activeUsers /
//     anonPresent` semantics (reviewer-pinned: NOT a "独立访客" claim),
//     defaults to 0/empty on empty D1, no-ctx path.
//   - listHandler: filter binding (path_kind), pagination clamps, label
//     batching (thread/forum/user only — single query per source table),
//     `Cache-Control: no-store, private`, 400 on unknown path_kind.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_internal,
	getTodayVisitsKpi,
	getTodayVisitsList,
} from "../../../../src/handlers/admin/todayVisits";
import { createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

// ─── Local helpers ──────────────────────────────────────────────

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
 * Configurable mock D1 with `prepare()` / `batch()` queues.
 *
 * `firstQueue` is consumed by .first() in call order. `allQueue` is
 * consumed by .all() in call order. `batchQueue` is consumed by
 * .batch() in call order — each entry is the array of canned per-stmt
 * results returned to the caller (each result is `{ results: [...] }`
 * to match D1's shape).
 */
function makeMockDb(opts: {
	firstQueue?: unknown[];
	allQueue?: Array<{ results: unknown[] }>;
	batchQueue?: Array<Array<{ results: unknown[] }>>;
}) {
	const calls: Array<{ sql: string; binds: unknown[] }> = [];
	const firstQueue = [...(opts.firstQueue ?? [])];
	const allQueue = [...(opts.allQueue ?? [])];
	const batchQueue = [...(opts.batchQueue ?? [])];

	const makePrepared = (sql: string) => {
		const binds: unknown[] = [];
		const prepared = {
			_sql: sql,
			_binds: binds,
			bind: vi.fn((...params: unknown[]) => {
				for (const p of params) binds.push(p);
				return prepared;
			}),
			first: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				return (firstQueue.shift() ?? null) as unknown;
			}),
			all: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				return (allQueue.shift() ?? { results: [] }) as { results: unknown[] };
			}),
			run: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				return { success: true, meta: { changes: 1, last_row_id: 1 } } as unknown;
			}),
		};
		return prepared;
	};

	const db = {
		prepare: vi.fn((sql: string) => makePrepared(sql)),
		batch: vi.fn(async (stmts: Array<{ _sql: string; _binds: unknown[] }>) => {
			// Record each statement in `calls` so the SQL assertions in the
			// tests below find both batched and non-batched queries through
			// the same lens.
			for (const s of stmts) {
				calls.push({ sql: s._sql, binds: [...s._binds] });
			}
			return (batchQueue.shift() ?? stmts.map(() => ({ results: [] }))) as Array<{
				results: unknown[];
			}>;
		}),
	} as unknown as D1Database & { _calls: typeof calls };
	(db as unknown as { _calls: typeof calls })._calls = calls;
	return db;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

// ─── Pure helpers ───────────────────────────────────────────────

describe("todayVisits — pure helpers", () => {
	it("shanghaiDateLocal returns YYYY-MM-DD for an Asia/Shanghai midday timestamp", () => {
		// 2026-01-01 12:00:00 UTC+8 == 2026-01-01 04:00:00 UTC.
		const nowSec = Math.floor(Date.UTC(2026, 0, 1, 4, 0, 0) / 1000);
		expect(_internal.shanghaiDateLocal(nowSec)).toBe("2026-01-01");
	});

	it("shanghaiDateLocal crosses Shanghai midnight at 16:00 UTC", () => {
		// 2026-01-01 23:59 Shanghai == 2026-01-01 15:59 UTC -> "2026-01-01".
		const beforeMidnight = Math.floor(Date.UTC(2026, 0, 1, 15, 59, 0) / 1000);
		// 2026-01-02 00:01 Shanghai == 2026-01-01 16:01 UTC -> "2026-01-02".
		const afterMidnight = Math.floor(Date.UTC(2026, 0, 1, 16, 1, 0) / 1000);
		expect(_internal.shanghaiDateLocal(beforeMidnight)).toBe("2026-01-01");
		expect(_internal.shanghaiDateLocal(afterMidnight)).toBe("2026-01-02");
	});

	it("PATH_KIND_VALUES covers the canonical 10-bucket enum", () => {
		expect([..._internal.PATH_KIND_VALUES].sort()).toEqual(
			[
				"auth_page",
				"checkin",
				"digest",
				"forum",
				"home",
				"messages",
				"other",
				"search",
				"thread",
				"user",
			].sort(),
		);
	});
});

// ─── KPI handler ─────────────────────────────────────────────────

describe("todayVisits — KPI handler", () => {
	it("returns aggregated counters with activeUsers + anonPresent semantics", async () => {
		const nowMs = Date.UTC(2026, 0, 1, 4, 0, 0); // 2026-01-01 12:00 Asia/Shanghai
		vi.setSystemTime(nowMs);

		const db = makeMockDb({
			batchQueue: [
				[
					{
						results: [
							{
								total_views: 100,
								human_views: 80,
								bot_search_views: 12,
								bot_other_views: 5,
								unknown_views: 3,
								distinct_targets: 27,
								active_users: 14,
								anon_present: 1,
							},
						],
					},
					{
						results: [
							{ path_kind: "thread", views: 60, targets: 18 },
							{ path_kind: "home", views: 25, targets: 1 },
							{ path_kind: "forum", views: 15, targets: 8 },
						],
					},
				],
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const ctx = makeCtx();

		const res = await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: Record<string, unknown> };
		expect(body.data.dateLocal).toBe("2026-01-01");
		expect(body.data.totalViews).toBe(100);
		expect(body.data.humanViews).toBe(80);
		expect(body.data.botSearchViews).toBe(12);
		expect(body.data.botOtherViews).toBe(5);
		expect(body.data.unknownViews).toBe(3);
		expect(body.data.distinctTargets).toBe(27);
		expect(body.data.activeUsers).toBe(14);
		expect(body.data.anonPresent).toBe(1);
		expect(body.data.byPathKind).toEqual([
			{ pathKind: "thread", views: 60, targets: 18 },
			{ pathKind: "home", views: 25, targets: 1 },
			{ pathKind: "forum", views: 15, targets: 8 },
		]);
	});

	it("SQL shape: single batch over analytics_daily_targets bound to today's date_local", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			batchQueue: [[{ results: [{ anon_present: 0 }] }, { results: [] }]],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const ctx = makeCtx();
		await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
			ctx,
		);
		const aggCalls = db._calls.filter(
			(c) => c.sql.includes("FROM analytics_daily_targets") && c.sql.includes("active_users"),
		);
		expect(aggCalls).toHaveLength(1);
		const sql = normalizeSql(aggCalls[0].sql);
		expect(sql).toContain("COUNT(DISTINCT CASE WHEN user_id > 0 THEN user_id END) AS active_users");
		expect(sql).toContain("MAX(CASE WHEN user_id = 0 THEN 1 ELSE 0 END) AS anon_present");
		expect(sql).toContain("WHERE date_local = ?");
		expect(aggCalls[0].binds).toEqual(["2026-01-01"]);

		const breakdownCalls = db._calls.filter(
			(c) => c.sql.includes("FROM analytics_daily_targets") && c.sql.includes("GROUP BY path_kind"),
		);
		expect(breakdownCalls).toHaveLength(1);
		expect(breakdownCalls[0].binds).toEqual(["2026-01-01"]);
	});

	it("filters out unknown path_kind values from byPathKind breakdown", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			batchQueue: [
				[
					{ results: [{ anon_present: 0 }] },
					{
						results: [
							{ path_kind: "thread", views: 1, targets: 1 },
							{ path_kind: "bogus", views: 99, targets: 99 },
						],
					},
				],
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const ctx = makeCtx();
		const res = await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
			ctx,
		);
		const body = (await res.json()) as { data: { byPathKind: unknown[] } };
		expect(body.data.byPathKind).toEqual([{ pathKind: "thread", views: 1, targets: 1 }]);
	});

	it("writes through KV cache under family `analytics:today-visits`", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			batchQueue: [[{ results: [{ anon_present: 0 }] }, { results: [] }]],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db as unknown as D1Database, KV: kv });
		const ctx = makeCtx();

		await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
			ctx,
		);
		await Promise.all(ctx._promises);

		expect(_internal.KPI_KV_KEY).toBe("analytics:today-visits");
		expect(_internal.KPI_FAMILY).toBe("analytics:today-visits");
		expect(_internal.KPI_TTL_SEC).toBe(60);
		expect(kv.put).toHaveBeenCalled();
	});

	it("loads from D1 when ctx is absent (no cache layer, no KV write)", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			batchQueue: [[{ results: [{ anon_present: 0 }] }, { results: [] }]],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db as unknown as D1Database, KV: kv });
		const res = await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
			// ctx absent
		);
		expect(res.status).toBe(200);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("defaults all counters to 0 / empty on empty aggregate", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({ batchQueue: [[{ results: [] }, { results: [] }]] });
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: Record<string, unknown> };
		expect(body.data.totalViews).toBe(0);
		expect(body.data.humanViews).toBe(0);
		expect(body.data.botSearchViews).toBe(0);
		expect(body.data.botOtherViews).toBe(0);
		expect(body.data.unknownViews).toBe(0);
		expect(body.data.distinctTargets).toBe(0);
		expect(body.data.activeUsers).toBe(0);
		expect(body.data.anonPresent).toBe(0);
		expect(body.data.byPathKind).toEqual([]);
	});

	it("coerces anon_present null to 0 (no rows for anonymous)", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			batchQueue: [[{ results: [{ anon_present: null }] }, { results: [] }]],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayVisitsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/visits"),
			env,
		);
		const body = (await res.json()) as { data: { anonPresent: number } };
		expect(body.data.anonPresent).toBe(0);
	});
});

// ─── List handler ────────────────────────────────────────────────

describe("todayVisits — list handler", () => {
	it("paginates + sets Cache-Control: no-store, private", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{ total: 2 }],
			allQueue: [
				{
					results: [
						{
							path_kind: "thread",
							target_id: 42,
							views: 30,
							human_views: 25,
							bot_search_views: 3,
							bot_other_views: 1,
							unknown_views: 1,
							unique_users: 12,
							first_seen_at: 1_700_000_000,
							last_seen_at: 1_700_001_000,
						},
						{
							path_kind: "home",
							target_id: 0,
							views: 20,
							human_views: 18,
							bot_search_views: 1,
							bot_other_views: 0,
							unknown_views: 1,
							unique_users: 0,
							first_seen_at: 1_700_000_500,
							last_seen_at: 1_700_001_500,
						},
					],
				},
				// label query (threads only — 42)
				{ results: [{ id: 42, subject: "Hello world" }] },
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		const res = await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list?page=1&limit=20"),
			env,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");

		const body = (await res.json()) as {
			data: {
				page: number;
				limit: number;
				total: number;
				rows: Array<Record<string, unknown>>;
			};
		};
		expect(body.data.page).toBe(1);
		expect(body.data.limit).toBe(20);
		expect(body.data.total).toBe(2);
		expect(body.data.rows).toHaveLength(2);
		expect(body.data.rows[0]).toEqual({
			pathKind: "thread",
			targetId: 42,
			label: "Hello world",
			views: 30,
			humanViews: 25,
			botSearchViews: 3,
			botOtherViews: 1,
			unknownViews: 1,
			uniqueUsers: 12,
			firstSeenAt: 1_700_000_000,
			lastSeenAt: 1_700_001_000,
		});
		expect(body.data.rows[1].label).toBe(""); // home has no label
	});

	it("rejects unknown path_kind filter with 400 INVALID_REQUEST", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list?path_kind=bogus"),
			env,
		);
		expect(res.status).toBe(400);
		expect(db._calls).toHaveLength(0);
	});

	it("path_kind filter is bound and added to WHERE clause", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{ total: 0 }],
			allQueue: [{ results: [] }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list?path_kind=forum"),
			env,
		);
		const listCalls = db._calls.filter(
			(c) => c.sql.includes("FROM analytics_daily_targets") && c.sql.includes("GROUP BY path_kind"),
		);
		expect(listCalls.length).toBeGreaterThanOrEqual(1);
		const listCall = listCalls.find((c) => c.sql.includes("ORDER BY views DESC"));
		expect(listCall).toBeDefined();
		if (!listCall) throw new Error("unreachable");
		const sql = normalizeSql(listCall.sql);
		expect(sql).toContain("path_kind = ?");
		expect(listCall.binds.slice(0, 2)).toEqual(["2026-01-01", "forum"]);
	});

	it("clamps limit to [1, LIST_PAGE_SIZE_MAX]", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{ total: 0 }],
			allQueue: [{ results: [] }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list?limit=10000&page=2"),
			env,
		);
		const body = (await res.json()) as { data: { limit: number; page: number } };
		expect(body.data.limit).toBe(_internal.LIST_PAGE_SIZE_MAX);
		expect(body.data.page).toBe(2);
	});

	it("issues at most one batched label query per source table (thread/forum/user)", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{ total: 4 }],
			allQueue: [
				{
					results: [
						{
							path_kind: "thread",
							target_id: 1,
							views: 1,
							human_views: 1,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 0,
							first_seen_at: 0,
							last_seen_at: 0,
						},
						{
							path_kind: "thread",
							target_id: 2,
							views: 1,
							human_views: 1,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 0,
							first_seen_at: 0,
							last_seen_at: 0,
						},
						{
							path_kind: "forum",
							target_id: 3,
							views: 1,
							human_views: 1,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 0,
							first_seen_at: 0,
							last_seen_at: 0,
						},
						{
							path_kind: "user",
							target_id: 4,
							views: 1,
							human_views: 1,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 0,
							first_seen_at: 0,
							last_seen_at: 0,
						},
					],
				},
				{
					results: [
						{ id: 1, subject: "T1" },
						{ id: 2, subject: "T2" },
					],
				},
				{ results: [{ id: 3, name: "F3" }] },
				{ results: [{ id: 4, username: "U4" }] },
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list"),
			env,
		);
		const labelCalls = db._calls.filter(
			(c) =>
				/FROM threads WHERE id IN/.test(c.sql) ||
				/FROM forums WHERE id IN/.test(c.sql) ||
				/FROM users WHERE id IN/.test(c.sql),
		);
		expect(labelCalls).toHaveLength(3);
		// Each query carries the unique ids batched.
		const threadCall = labelCalls.find((c) => /FROM threads/.test(c.sql));
		expect(threadCall?.binds).toEqual([1, 2]);
		const forumCall = labelCalls.find((c) => /FROM forums/.test(c.sql));
		expect(forumCall?.binds).toEqual([3]);
		const userCall = labelCalls.find((c) => /FROM users/.test(c.sql));
		expect(userCall?.binds).toEqual([4]);
	});

	it("skips label queries for path_kinds without a target row (home, digest, etc.)", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{ total: 1 }],
			allQueue: [
				{
					results: [
						{
							path_kind: "home",
							target_id: 0,
							views: 5,
							human_views: 5,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 0,
							first_seen_at: 0,
							last_seen_at: 0,
						},
					],
				},
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list"),
			env,
		);
		const labelCalls = db._calls.filter(
			(c) =>
				/FROM threads WHERE id IN/.test(c.sql) ||
				/FROM forums WHERE id IN/.test(c.sql) ||
				/FROM users WHERE id IN/.test(c.sql),
		);
		expect(labelCalls).toHaveLength(0);
	});
});

// ─── isTodayVisitsKpi validator unit tests ──────────────────────
//
// The validator is plugged into `cacheGetOrSet` as the cached-shape
// gate. Each branch is exercised directly so a future regression in
// the shape contract surfaces immediately, not via a re-fetched
// payload masking it.

describe("todayVisits — sparse SQL fallbacks", () => {
	it("list handler defaults nullable numeric columns to 0", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{}], // total row missing `total` field
			allQueue: [
				{
					// list query — every numeric field absent so `?? 0` fires.
					results: [
						{
							path_kind: "thread",
							target_id: 9,
							views: null,
							human_views: null,
							bot_search_views: null,
							bot_other_views: null,
							unknown_views: null,
							unique_users: null,
							first_seen_at: null,
							last_seen_at: null,
						},
					],
				},
				// thread label query — row has subject=null so the `?? ""`
				// fallback at L391 fires.
				{ results: [{ id: 9, subject: null }] },
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list"),
			env,
		);
		const body = (await res.json()) as {
			data: { total: number; rows: Array<Record<string, number | string>> };
		};
		expect(body.data.total).toBe(0);
		const row = body.data.rows[0];
		expect(row.views).toBe(0);
		expect(row.humanViews).toBe(0);
		expect(row.botSearchViews).toBe(0);
		expect(row.botOtherViews).toBe(0);
		expect(row.unknownViews).toBe(0);
		expect(row.uniqueUsers).toBe(0);
		expect(row.firstSeenAt).toBe(0);
		expect(row.lastSeenAt).toBe(0);
		// resolveLabels: thread subject was null → label coerced to "".
		expect(row.label).toBe("");
	});

	it("list handler ?? '' fallback fires for null forum.name and null user.username", async () => {
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({
			firstQueue: [{ total: 2 }],
			allQueue: [
				{
					results: [
						{
							path_kind: "forum",
							target_id: 5,
							views: 1,
							human_views: 1,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 1,
							first_seen_at: 100,
							last_seen_at: 200,
						},
						{
							path_kind: "user",
							target_id: 7,
							views: 1,
							human_views: 1,
							bot_search_views: 0,
							bot_other_views: 0,
							unknown_views: 0,
							unique_users: 1,
							first_seen_at: 100,
							last_seen_at: 200,
						},
					],
				},
				// forum label query: name null → "" fallback at L403.
				{ results: [{ id: 5, name: null }] },
				// user label query: username null → "" fallback at L415.
				{ results: [{ id: 7, username: null }] },
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayVisitsList(
			createAdminRequest("GET", "/api/admin/analytics/today/visits/list"),
			env,
		);
		const body = (await res.json()) as { data: { rows: Array<Record<string, unknown>> } };
		const forumRow = body.data.rows.find((r) => r.pathKind === "forum");
		const userRow = body.data.rows.find((r) => r.pathKind === "user");
		expect(forumRow?.label).toBe("");
		expect(userRow?.label).toBe("");
	});
});

describe("isTodayVisitsKpi (cache validator)", () => {
	const { isTodayVisitsKpi } = _internal;

	const VALID = {
		now: 1700000000,
		dateLocal: "2026-01-01",
		totalViews: 10,
		humanViews: 8,
		botSearchViews: 1,
		botOtherViews: 0,
		unknownViews: 1,
		distinctTargets: 3,
		activeUsers: 2,
		anonPresent: 1 as 0 | 1,
		byPathKind: [{ pathKind: "thread" as const, views: 5, targets: 2 }],
	};

	it("accepts a complete payload", () => {
		expect(isTodayVisitsKpi(VALID)).toBe(true);
	});

	it("accepts anonPresent=0 and empty byPathKind", () => {
		expect(isTodayVisitsKpi({ ...VALID, anonPresent: 0, byPathKind: [] })).toBe(true);
	});

	it("rejects null/undefined/primitive", () => {
		expect(isTodayVisitsKpi(null)).toBe(false);
		expect(isTodayVisitsKpi(undefined)).toBe(false);
		expect(isTodayVisitsKpi("x")).toBe(false);
		expect(isTodayVisitsKpi(123)).toBe(false);
	});

	it("rejects non-number `now`", () => {
		expect(isTodayVisitsKpi({ ...VALID, now: "x" })).toBe(false);
	});

	it("rejects non-string `dateLocal`", () => {
		expect(isTodayVisitsKpi({ ...VALID, dateLocal: 20260101 })).toBe(false);
	});

	it("rejects non-number numeric fields", () => {
		for (const k of [
			"totalViews",
			"humanViews",
			"botSearchViews",
			"botOtherViews",
			"unknownViews",
			"distinctTargets",
			"activeUsers",
		]) {
			expect(isTodayVisitsKpi({ ...VALID, [k]: "x" })).toBe(false);
		}
	});

	it("rejects anonPresent outside {0,1}", () => {
		expect(isTodayVisitsKpi({ ...VALID, anonPresent: 2 })).toBe(false);
		expect(isTodayVisitsKpi({ ...VALID, anonPresent: -1 })).toBe(false);
		expect(isTodayVisitsKpi({ ...VALID, anonPresent: "1" })).toBe(false);
	});

	it("rejects non-array byPathKind", () => {
		expect(isTodayVisitsKpi({ ...VALID, byPathKind: {} })).toBe(false);
		expect(isTodayVisitsKpi({ ...VALID, byPathKind: "x" })).toBe(false);
	});

	it("rejects byPathKind entry that is not an object", () => {
		expect(isTodayVisitsKpi({ ...VALID, byPathKind: [null] })).toBe(false);
		expect(isTodayVisitsKpi({ ...VALID, byPathKind: ["x"] })).toBe(false);
	});

	it("rejects byPathKind entry with non-string pathKind", () => {
		expect(
			isTodayVisitsKpi({ ...VALID, byPathKind: [{ pathKind: 1, views: 0, targets: 0 }] }),
		).toBe(false);
	});

	it("rejects byPathKind entry with unknown pathKind", () => {
		expect(
			isTodayVisitsKpi({
				...VALID,
				byPathKind: [{ pathKind: "not_a_kind", views: 0, targets: 0 }],
			}),
		).toBe(false);
	});

	it("rejects byPathKind entry with non-number views/targets", () => {
		expect(
			isTodayVisitsKpi({
				...VALID,
				byPathKind: [{ pathKind: "thread", views: "x", targets: 0 }],
			}),
		).toBe(false);
		expect(
			isTodayVisitsKpi({
				...VALID,
				byPathKind: [{ pathKind: "thread", views: 0, targets: "x" }],
			}),
		).toBe(false);
	});
});
