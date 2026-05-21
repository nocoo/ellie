// Admin login-history handler unit tests (P4 audit endpoints).
//
// Coverage:
//   - maskIp(): IPv4 keep-2-octet, IPv6 keep-2-group, pass-through on
//     malformed input.
//   - localTodayStart(): Asia/Shanghai (UTC+8) local midnight anchoring.
//   - kpiHandler: KV cache key + family + TTL via cacheGetOrSet, SQL
//     shape (single-pass conditional SUMs over today's window).
//   - listHandler: filter binding (ok / kind / errorCode), pagination
//     clamps, IP masking on response, `Cache-Control: no-store, private`.
//   - revealHandler: method gate (405 on GET), id validation (400),
//     row-not-found path (404, NO writeAdminLog), success path
//     (admin_logs row inserted with action
//     `analytics.login_history.reveal`, details EXCLUDE ip/ua/username,
//     response is no-store + carries raw ip/ua/username).

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	_internal,
	getTodayLoginsKpi,
	getTodayLoginsList,
	revealLoginHistory,
} from "../../../../src/handlers/admin/loginHistory";
import { TEST_ADMIN_API_KEY, createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

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

	it("isTodayLoginsKpi rejects non-object / null / missing fields", () => {
		expect(_internal.isTodayLoginsKpi(null)).toBe(false);
		expect(_internal.isTodayLoginsKpi(undefined)).toBe(false);
		expect(_internal.isTodayLoginsKpi("not-an-object")).toBe(false);
		expect(_internal.isTodayLoginsKpi(42)).toBe(false);
		// Object but missing fields → false on first typeof check.
		expect(_internal.isTodayLoginsKpi({})).toBe(false);
		// One missing field at the end of the chain.
		expect(
			_internal.isTodayLoginsKpi({
				now: 0,
				dayStart: 0,
				totalAttempts: 0,
				successAttempts: 0,
				failedAttempts: 0,
				uniqueUsers: 0,
				uniqueIps: 0,
				loginAttempts: 0,
				// registerAttempts missing
			}),
		).toBe(false);
		// All numeric → true.
		expect(
			_internal.isTodayLoginsKpi({
				now: 0,
				dayStart: 0,
				totalAttempts: 0,
				successAttempts: 0,
				failedAttempts: 0,
				uniqueUsers: 0,
				uniqueIps: 0,
				loginAttempts: 0,
				registerAttempts: 0,
			}),
		).toBe(true);
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

	it("writes through KV cache under family `analytics:today-logins`", async () => {
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
		const kv = createMockKV();
		const env = makeEnv({ DB: db as unknown as D1Database, KV: kv });
		const ctx = makeCtx();

		await getTodayLoginsKpi(
			createAdminRequest("GET", "/api/admin/analytics/today/logins"),
			env,
			ctx,
		);

		// cacheGetOrSet defers the put via ctx.waitUntil — drain.
		await Promise.all(ctx._promises);

		// Internal contract: registered KV key is exact literal.
		expect(_internal.KPI_KV_KEY).toBe("analytics:today-logins");
		expect(_internal.KPI_FAMILY).toBe("analytics:today-logins");
		expect(_internal.KPI_TTL_SEC).toBe(60);
		// We don't assert raw put args — wrap layer rotates by family + key —
		// but at minimum a put occurred.
		expect(kv.put).toHaveBeenCalled();
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

	it("paginates + masks IPs, sets Cache-Control: no-store, private", async () => {
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
					ipMasked: string;
					username: string;
					userId: number | null;
				}>;
			};
		};
		expect(body.data.page).toBe(1);
		expect(body.data.limit).toBe(20);
		expect(body.data.total).toBe(2);
		expect(body.data.rows).toHaveLength(2);
		expect(body.data.rows[0].ipMasked).toBe("1.2.x.x");
		expect(body.data.rows[1].ipMasked).toBe("2001:db8::x");
		// Raw `ip` field must NOT be on the masked list response.
		expect(JSON.stringify(body.data.rows[0])).not.toMatch(/1\.2\.3\.4/);
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

// ─── Reveal handler ─────────────────────────────────────────────

describe("loginHistory — reveal handler", () => {
	it("405 on GET (method gate)", async () => {
		const env = makeEnv();
		const res = await revealLoginHistory(
			createAdminRequest("GET", "/api/admin/analytics/login-history/1/reveal"),
			env,
		);
		expect(res.status).toBe(405);
	});

	it("400 on missing id segment", async () => {
		const env = makeEnv();
		const res = await revealLoginHistory(
			createAdminRequest("POST", "/api/admin/analytics/login-history/abc/reveal"),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("400 on non-positive id", async () => {
		// Path regex `\d+` rejects '-1', so id=0 is the smallest reachable
		// numeric id that must still be rejected by the in-handler guard.
		const env = makeEnv();
		const res = await revealLoginHistory(
			createAdminRequest("POST", "/api/admin/analytics/login-history/0/reveal"),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("404 without writing admin_logs when row absent", async () => {
		const db = makeMockDb({ canned: [{ first: null }] });
		const env = makeEnv({ DB: db as unknown as D1Database });

		const res = await revealLoginHistory(
			createAdminRequest("POST", "/api/admin/analytics/login-history/9999/reveal"),
			env,
		);
		expect(res.status).toBe(404);
		// Only one DB call (the SELECT) — no admin_logs INSERT.
		expect(db._calls).toHaveLength(1);
		expect(db._calls[0].sql).toContain("FROM login_history");
	});

	it("writes admin_logs on success with action and details excluding ip/ua/username", async () => {
		const row = {
			id: 42,
			user_id: 7,
			username: "alice",
			ok: 0 as 0 | 1,
			kind: "login",
			error_code: "INVALID_CREDENTIALS",
			ip: "203.0.113.45",
			user_agent: "Mozilla/5.0 (X11; Linux) Chrome/120 ua-leak",
			bot_class: "human",
			created_at: 1700,
		};
		const db = makeMockDb({
			canned: [{ first: row }, { run: { success: true, meta: { changes: 1, last_row_id: 1 } } }],
		});
		const env = makeEnv({ DB: db as unknown as D1Database });

		// Reveal request carries the admin actor email header that the BFF
		// would inject via adminApiAs(admin, request).raw("POST", ...).
		const req = new Request("https://api.example.com/api/admin/analytics/login-history/42/reveal", {
			method: "POST",
			headers: {
				"X-API-Key": TEST_ADMIN_API_KEY,
				"X-Admin-Actor-Email": "ops@hexly.ai",
				"X-Admin-Actor-Name": "ops",
			},
		});
		const res = await revealLoginHistory(req, env);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");

		// Body returns the full row (ip + ua + username) for the legitimate admin caller.
		const body = (await res.json()) as { data: Record<string, unknown> };
		expect(body.data.id).toBe(42);
		expect(body.data.ip).toBe(row.ip);
		expect(body.data.userAgent).toBe(row.user_agent);
		expect(body.data.username).toBe(row.username);

		// admin_logs INSERT must have happened.
		expect(db._calls).toHaveLength(2);
		const insert = db._calls[1];
		expect(insert.sql).toContain("INSERT INTO admin_logs");
		// Binds shape: (admin_id, admin_name, action, target_type, target_id, details, ip, created_at)
		expect(insert.binds[0]).toBe(0); // SYSTEM_ACTOR_ID — admin sessions are email-keyed
		expect(insert.binds[1]).toBe("ops"); // X-Admin-Actor-Name
		expect(insert.binds[2]).toBe("analytics.login_history.reveal");
		expect(insert.binds[3]).toBe("login_history");
		expect(insert.binds[4]).toBe(42);
		const detailsJson = insert.binds[5] as string;
		const details = JSON.parse(detailsJson);
		// EXCLUDE: raw ip, user_agent, username.
		expect(details).not.toHaveProperty("ip");
		expect(details).not.toHaveProperty("userAgent");
		expect(details).not.toHaveProperty("user_agent");
		expect(details).not.toHaveProperty("username");
		// INCLUDE: contextual non-PII fields + auto-merged actorEmail.
		expect(details.loginHistoryId).toBe(42);
		expect(details.ok).toBe(0);
		expect(details.kind).toBe("login");
		expect(details.errorCode).toBe("INVALID_CREDENTIALS");
		expect(details.botClass).toBe("human");
		expect(details.createdAt).toBe(1700);
		expect(details.actorEmail).toBe("ops@hexly.ai");
	});
});
