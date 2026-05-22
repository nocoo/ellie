// Admin login-history handler unit tests (P4 audit endpoints).
//
// Coverage:
//   - maskIp(): IPv4 keep-2-octet, IPv6 keep-2-group, pass-through on
//     malformed input.
//   - localTodayStart(): Asia/Shanghai (UTC+8) local midnight anchoring.
//   - kpiHandler: SQL shape (single-pass conditional SUMs over today's window).
//   - listHandler: filter binding (ok / kind / errorCode), pagination
//     clamps, raw IP in response, `Cache-Control: no-store, private`.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	_internal,
	getTodayLoginsKpi,
	getTodayLoginsList,
} from "../../../../src/handlers/admin/loginHistory";
import { createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

// ─── Local helpers ─────────────────────────────────────────────

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
 * Configurable mock D1. Each prepare() returns a chainable that records
 * (sql, binds) and resolves first()/all() against the canned queue in
 * preparation order.
 */
function makeMockDb(opts: {
	canned?: Array<{ first?: unknown; all?: { results: unknown[] }; run?: unknown }>;
}) {
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
			first: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				const next = canned[cursor++] ?? {};
				return (next.first ?? null) as unknown;
			}),
			all: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				const next = canned[cursor++] ?? { all: { results: [] } };
				return (next.all ?? { results: [] }) as { results: unknown[] };
			}),
			run: vi.fn(async () => {
				calls.push({ sql, binds: [...binds] });
				const next = canned[cursor++] ?? {};
				return (next.run ?? { success: true, meta: { changes: 1, last_row_id: 1 } }) as unknown;
			}),
		};
		return prepared;
	};

	const db = {
		prepare: vi.fn((sql: string) => makePrepared(sql)),
	} as unknown as D1Database & { _calls: typeof calls };
	(db as unknown as { _calls: typeof calls })._calls = calls;
	return db;
}

// ─── Pure helpers ───────────────────────────────────────────────

describe("loginHistory — pure helpers", () => {
	it("localTodayStart anchors to Asia/Shanghai local midnight", () => {
		// 2026-01-01 00:00:00 UTC+8 == 2025-12-31 16:00:00 UTC.
		const utcMidnight = Math.floor(Date.UTC(2025, 11, 31, 16, 0, 0) / 1000);
		const nowSec = utcMidnight + 3600; // 1h into the local day
		expect(_internal.localTodayStart(nowSec)).toBe(utcMidnight);
	});

	it("maskIp keeps first two octets of IPv4", () => {
		expect(_internal.maskIp("1.2.3.4")).toBe("1.2.x.x");
		expect(_internal.maskIp("192.168.0.1")).toBe("192.168.x.x");
	});

	it("maskIp keeps first two groups of IPv6", () => {
		expect(_internal.maskIp("2001:db8:abcd:1234::5")).toBe("2001:db8::x");
	});

	it("maskIp collapses unrecognized shapes to 'unknown' (never raw)", () => {
		// Empty / junk / partial fragments must NOT pass through — this is
		// the default-masked endpoint's last line of defense against a
		// non-IPv4-non-IPv6 value reaching the admin UI.
		expect(_internal.maskIp("")).toBe("unknown");
		expect(_internal.maskIp("not-an-ip")).toBe("unknown");
		expect(_internal.maskIp("1.2.3")).toBe("unknown");
		expect(_internal.maskIp("1.2.3.4.5")).toBe("unknown"); // too many segments
		expect(_internal.maskIp("a.b.c.d")).toBe("unknown"); // non-digit octets
		expect(_internal.maskIp(":")).toBe("unknown"); // truncated v6
		expect(_internal.maskIp("::1")).toBe("unknown"); // leading-empty v6 fragment
	});

	it("isTodayLoginsKpi removed (KV bypass): loginHistoryConfig.mapper is identity", () => {
		// The previous KPI validator (`isTodayLoginsKpi`) was removed when this
		// endpoint stopped writing through KV — admin moderation needs realtime
		// counters, so we return no-store every time. This test pins the
		// removal so a future refactor that re-introduces a KPI validator must
		// also re-add the corresponding KV bypass.
		expect(_internal as Record<string, unknown>).not.toHaveProperty("isTodayLoginsKpi");
	});

	it("loginHistoryConfig.mapper returns the row unchanged (identity)", () => {
		// withEntityAuth never invokes mapper for these handlers — it's there
		// only because EntityConfig requires it. Pin identity behavior so a
		// future refactor that wires the mapper into a path can't silently
		// reshape rows.
		const row = { id: 1, foo: "bar" };
		expect(_internal.loginHistoryConfig.mapper(row)).toEqual(row);
	});
});

// ─── KPI handler ────────────────────────────────────────────────

describe("loginHistory — KPI handler", () => {
	afterEach(() => vi.useRealTimers());

	it("returns single-SQL-pass conditional SUM aggregates on cache miss", async () => {
		// Pin clock: 2026-01-01 12:00 local (UTC+8) → 04:00 UTC.
		const nowMs = Date.UTC(2026, 0, 1, 4, 0, 0);
		vi.useFakeTimers();
		vi.setSystemTime(nowMs);

		const dayStart = Math.floor(Date.UTC(2025, 11, 31, 16, 0, 0) / 1000);

		const db = makeMockDb({
			canned: [
				{
					first: {
						total: 42,
						success: 30,
						failed: 12,
						unique_users: 25,
						unique_ips: 18,
						login_attempts: 35,
						register_attempts: 7,
					},
				},
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database, KV: createMockKV() });
		const ctx = makeCtx();

		const res = await getTodayLoginsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/logins"),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: Record<string, number> };
		expect(body.data.totalAttempts).toBe(42);
		expect(body.data.successAttempts).toBe(30);
		expect(body.data.failedAttempts).toBe(12);
		expect(body.data.uniqueUsers).toBe(25);
		expect(body.data.uniqueIps).toBe(18);
		expect(body.data.loginAttempts).toBe(35);
		expect(body.data.registerAttempts).toBe(7);
		expect(body.data.dayStart).toBe(dayStart);

		// SQL shape: single conditional-SUM scan against login_history. The
		// cache layer may issue its own bookkeeping SQL — we filter to the
		// login_history loader to keep the shape pin focused.
		const kpiCalls = db._calls.filter((c) => c.sql.includes("FROM login_history"));
		expect(kpiCalls).toHaveLength(1);
		const sql = normalizeSql(kpiCalls[0].sql);
		expect(sql).toContain("FROM login_history");
		expect(sql).toContain("WHERE created_at >= ?");
		expect(sql).toContain("SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS success");
		expect(sql).toContain("SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed");
		expect(sql).toContain("COUNT(DISTINCT ip) AS unique_ips");
		expect(sql).toContain("SUM(CASE WHEN kind = 'login' THEN 1 ELSE 0 END) AS login_attempts");
		expect(sql).toContain(
			"SUM(CASE WHEN kind = 'register' THEN 1 ELSE 0 END) AS register_attempts",
		);
		expect(kpiCalls[0].binds).toEqual([dayStart]);
	});

	it("bypasses KV: never reads or writes the cache and replies no-store", async () => {
		const nowMs = Date.UTC(2026, 0, 1, 4, 0, 0);
		vi.useFakeTimers();
		vi.setSystemTime(nowMs);

		const db = makeMockDb({
			canned: [
				{
					first: {
						total: 1,
						success: 1,
						failed: 0,
						unique_users: 1,
						unique_ips: 1,
						login_attempts: 1,
						register_attempts: 0,
					},
				},
			],
		});
		const kv = createMockKV({
			"analytics:today-logins": JSON.stringify({ totalAttempts: 999 }),
		});
		const env = makeEnv({ DB: db as unknown as D1Database, KV: kv });
		const ctx = makeCtx();

		const res = await getTodayLoginsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/logins"),
			env,
			ctx,
		);
		await Promise.all(ctx._promises);

		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();

		// Pinned removal of the cache wiring constants — see test above.
		expect(_internal as Record<string, unknown>).not.toHaveProperty("KPI_KV_KEY");
		expect(_internal as Record<string, unknown>).not.toHaveProperty("KPI_FAMILY");
		expect(_internal as Record<string, unknown>).not.toHaveProperty("KPI_TTL_SEC");

		// And the D1 KPI loader was actually invoked (no stale KV short-circuit).
		const kpiCalls = db._calls.filter((c) => c.sql.includes("FROM login_history"));
		expect(kpiCalls).toHaveLength(1);
	});

	it("loads from D1 when ctx is absent (no cache layer)", async () => {
		const nowMs = Date.UTC(2026, 0, 1, 4, 0, 0);
		vi.useFakeTimers();
		vi.setSystemTime(nowMs);

		const db = makeMockDb({
			canned: [
				{
					first: {
						total: 5,
						success: 5,
						failed: 0,
						unique_users: 5,
						unique_ips: 5,
						login_attempts: 5,
						register_attempts: 0,
					},
				},
			],
		});
		const kv = createMockKV();
		const env = makeEnv({ DB: db as unknown as D1Database, KV: kv });

		const res = await getTodayLoginsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/logins"),
			env,
			// ctx absent on purpose
		);
		expect(res.status).toBe(200);
		const kpiCalls = db._calls.filter((c) => c.sql.includes("FROM login_history"));
		expect(kpiCalls).toHaveLength(1);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("defaults all KPI counters to 0 when D1 returns null row", async () => {
		// Pins the `Number(row?.X ?? 0)` fallback chain — empty login_history
		// is the steady-state shape on a fresh deploy / before any login.
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		const db = makeMockDb({ canned: [{ first: null }] });
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayLoginsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/logins"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: Record<string, number> };
		expect(body.data.totalAttempts).toBe(0);
		expect(body.data.successAttempts).toBe(0);
		expect(body.data.failedAttempts).toBe(0);
		expect(body.data.uniqueUsers).toBe(0);
		expect(body.data.uniqueIps).toBe(0);
		expect(body.data.loginAttempts).toBe(0);
		expect(body.data.registerAttempts).toBe(0);
	});
});

// ─── List handler ───────────────────────────────────────────────

describe("loginHistory — list handler", () => {
	afterEach(() => vi.useRealTimers());

	it("paginates with raw IPs, sets Cache-Control: no-store, private", async () => {
		const nowMs = Date.UTC(2026, 0, 1, 4, 0, 0);
		vi.useFakeTimers();
		vi.setSystemTime(nowMs);

		const db = makeMockDb({
			canned: [
				{ first: { total: 2 } },
				{
					all: {
						results: [
							{
								id: 100,
								user_id: 7,
								username: "alice",
								ok: 1,
								kind: "login",
								error_code: "",
								ip: "1.2.3.4",
								user_agent: "Mozilla/5.0",
								bot_class: "human",
								created_at: 1000,
							},
							{
								id: 99,
								user_id: null,
								username: "bob",
								ok: 0,
								kind: "login",
								error_code: "INVALID_CREDENTIALS",
								ip: "2001:db8:cafe:1234::1",
								user_agent: "curl/7.0",
								bot_class: "ua-bot",
								created_at: 999,
							},
						],
					},
				},
			],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		const res = await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list?page=1&limit=20"),
			env,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");

		const body = (await res.json()) as {
			data: {
				page: number;
				limit: number;
				total: number;
				rows: Array<{
					id: number;
					ip: string;
					userAgent: string;
					username: string;
					userId: number | null;
				}>;
			};
		};
		expect(body.data.page).toBe(1);
		expect(body.data.limit).toBe(20);
		expect(body.data.total).toBe(2);
		expect(body.data.rows).toHaveLength(2);
		expect(body.data.rows[0].ip).toBe("1.2.3.4");
		expect(body.data.rows[1].ip).toBe("2001:db8:cafe:1234::1");
	});

	it("binds filters ok/kind/errorCode when supplied", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));

		const db = makeMockDb({
			canned: [{ first: { total: 0 } }, { all: { results: [] } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		await getTodayLoginsList(
			createAdminRequest(
				"GET",
				"/api/admin/analytics/today/logins/list?ok=0&kind=register&errorCode=USERNAME_TAKEN",
			),
			env,
		);

		expect(db._calls).toHaveLength(2);
		const countSql = normalizeSql(db._calls[0].sql);
		expect(countSql).toContain("ok = ?");
		expect(countSql).toContain("kind = ?");
		expect(countSql).toContain("error_code = ?");
		// dayStart + ok=0 + kind='register' + errorCode='USERNAME_TAKEN'
		expect(db._calls[0].binds.slice(1)).toEqual([0, "register", "USERNAME_TAKEN"]);
	});

	it("clamps page size to LIST_PAGE_SIZE_MAX", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));

		const db = makeMockDb({
			canned: [{ first: { total: 0 } }, { all: { results: [] } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list?limit=5000"),
			env,
		);

		// LIMIT + OFFSET on the data query: last two binds.
		const dataBinds = db._calls[1].binds;
		const limitBind = dataBinds[dataBinds.length - 2];
		expect(limitBind).toBe(_internal.LIST_PAGE_SIZE_MAX);
	});

	it("falls back to LIST_PAGE_SIZE_DEFAULT on non-numeric limit", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));

		const db = makeMockDb({
			canned: [{ first: { total: 0 } }, { all: { results: [] } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list?limit=NaN"),
			env,
		);
		const dataBinds = db._calls[1].binds;
		const limitBind = dataBinds[dataBinds.length - 2];
		expect(limitBind).toBe(_internal.LIST_PAGE_SIZE_DEFAULT);
	});

	it("ignores unknown ok / kind values", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));

		const db = makeMockDb({
			canned: [{ first: { total: 0 } }, { all: { results: [] } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list?ok=bogus&kind=junk"),
			env,
		);
		// Only the dayStart filter binds (count + data each get one).
		expect(db._calls[0].binds).toHaveLength(1);
	});

	it("falls back to page=1 on non-numeric page", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));

		const db = makeMockDb({
			canned: [{ first: { total: 0 } }, { all: { results: [] } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		const res = await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list?page=abc"),
			env,
		);
		expect(res.status).toBe(200);
		// OFFSET bind is last; must be 0 (= (1 - 1) * limit), not NaN.
		const dataBinds = db._calls[1].binds;
		const offsetBind = dataBinds[dataBinds.length - 1];
		expect(offsetBind).toBe(0);
		const body = (await res.json()) as { data: { page: number } };
		expect(body.data.page).toBe(1);
	});

	it("handles missing results array and null count gracefully", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(Date.UTC(2026, 0, 1, 4, 0, 0));
		// `first` returns null → countRow?.total ?? 0 path; `all` returns
		// undefined results → (listResult.results ?? []) fallback.
		const db = makeMockDb({
			canned: [{ first: null }, { all: { results: undefined as unknown as unknown[] } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });
		const res = await getTodayLoginsList(
			createAdminRequest("GET", "/api/admin/analytics/today/logins/list"),
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { total: number; rows: unknown[] };
		};
		expect(body.data.total).toBe(0);
		expect(body.data.rows).toEqual([]);
	});
});
