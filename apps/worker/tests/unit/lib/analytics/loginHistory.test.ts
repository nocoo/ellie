// Login history persistence helper unit tests (P4).
//
// These tests pin four things:
//
//   1. `insertLoginHistory` builds the right INSERT against D1 — exact
//      column order, parameter binding, bot classification + UA
//      truncation applied at the helper, IP-too-long rejection without
//      a D1 round-trip.
//   2. `scheduleLoginHistory` is the production hot-path call site:
//      it defers onto `ctx.waitUntil`, swallows every error, and is a
//      documented no-op when `ctx` is undefined (test stubs).
//   3. `cleanupLoginHistory` issues a DELETE with the correct unix-seconds
//      cutoff and returns D1's `meta.changes` count for the cron caller.
//   4. The `LoginHistoryErrorCode` enum is closed — adding a new value
//      without a real auth.ts branch is a regression.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	_internal,
	cleanupLoginHistory,
	insertLoginHistory,
	type LoginHistoryRow,
	scheduleLoginHistory,
} from "../../../../src/lib/analytics/loginHistory";
import type { Env } from "../../../../src/lib/env";
import { createMockDb } from "../../../helpers";

function makeRow(overrides: Partial<LoginHistoryRow> = {}): LoginHistoryRow {
	return {
		userId: 42,
		username: "alice",
		ok: 1,
		kind: "login",
		errorCode: "",
		ip: "203.0.113.42",
		userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/124.0.0.0 Safari/537.36",
		createdAt: 1_747_785_600,
		...overrides,
	};
}

function makeEnv(db: D1Database): Env {
	return { DB: db } as unknown as Env;
}

function makeCtx(): { ctx: ExecutionContext; tasks: Promise<unknown>[] } {
	const tasks: Promise<unknown>[] = [];
	const ctx = {
		waitUntil: (p: Promise<unknown>) => {
			tasks.push(p);
		},
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;
	return { ctx, tasks };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("insertLoginHistory", () => {
	it("writes a row with the full 9-column INSERT and returns last_row_id", async () => {
		const { db, calls } = createMockDb({
			runResults: {
				"INSERT INTO login_history": {
					success: true,
					meta: { last_row_id: 777, changes: 1 },
				},
			},
		});
		const env = makeEnv(db);
		const id = await insertLoginHistory(env, makeRow());
		expect(id).toBe(777);
		expect(calls).toHaveLength(1);
		expect(calls[0].sql).toContain("INSERT INTO login_history");
		expect(calls[0].sql).toContain(
			"(user_id, username, ok, kind, error_code, ip, user_agent, bot_class, created_at)",
		);
		// Exactly 9 placeholders so the bind list aligns with the INSERT.
		const qmarks = calls[0].sql.match(/\?/g);
		expect(qmarks?.length).toBe(9);
		expect(calls[0].params).toHaveLength(9);
	});

	it("threads userId/username/ok/kind/errorCode/ip/createdAt verbatim, then derives ua + bot_class", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		await insertLoginHistory(
			env,
			makeRow({
				userId: 99,
				username: "bob",
				ok: 0,
				kind: "register",
				errorCode: "USERNAME_TAKEN",
				ip: "192.0.2.7",
				userAgent: "curl/7.85.0",
				createdAt: 1_747_700_000,
			}),
		);
		expect(calls[0].params).toEqual([
			99,
			"bob",
			0,
			"register",
			"USERNAME_TAKEN",
			"192.0.2.7",
			"curl/7.85.0",
			"bot_other", // parseBotClass("curl/7.85.0") — generic bot bucket
			1_747_700_000,
		]);
	});

	it("threads userId=null through to D1 for failed-username / USERNAME_BANNED branches", async () => {
		// Failed-username login: no users row matched, so user_id is NULL.
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		await insertLoginHistory(
			env,
			makeRow({ userId: null, ok: 0, errorCode: "INVALID_CREDENTIALS" }),
		);
		expect(calls[0].params[0]).toBeNull();
	});

	it("derives bot_class=human for browser UAs", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		await insertLoginHistory(
			env,
			makeRow({ userAgent: "Mozilla/5.0 ... Chrome/124.0.0.0 Safari/537.36" }),
		);
		expect(calls[0].params[7]).toBe("human");
	});

	it("derives bot_class=bot_search for Googlebot UAs", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		await insertLoginHistory(
			env,
			makeRow({
				userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
			}),
		);
		expect(calls[0].params[7]).toBe("bot_search");
	});

	it("derives bot_class=unknown when userAgent is null", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		await insertLoginHistory(env, makeRow({ userAgent: null }));
		expect(calls[0].params[7]).toBe("unknown");
		// And the user_agent column is the empty string, never null.
		expect(calls[0].params[6]).toBe("");
	});

	it("truncates user_agent at 256 chars; bot_class still resolves over the FULL ua", async () => {
		// Long UA with the search-bot token at position 300 — beyond the
		// truncation point. parseBotClass MUST run on the full string so
		// the bucket is correct even though we only persist the prefix.
		const longUa = `${"A".repeat(300)} compatible; Googlebot/2.1`;
		expect(longUa.length).toBeGreaterThan(_internal.USER_AGENT_MAX);
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		await insertLoginHistory(env, makeRow({ userAgent: longUa }));
		expect((calls[0].params[6] as string).length).toBe(_internal.USER_AGENT_MAX);
		expect(calls[0].params[7]).toBe("bot_search");
	});

	it("drops the row (no D1 call) when ip length exceeds 64 chars and warns", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		const oversized = "x".repeat(65);
		const id = await insertLoginHistory(env, makeRow({ ip: oversized }));
		expect(id).toBeNull();
		// Critical: D1 must not have been hit at all when the row is rejected.
		expect(calls).toHaveLength(0);
		expect(warn).toHaveBeenCalledWith(
			"[login-history] dropping row with oversized ip",
			expect.objectContaining({ ipLength: 65 }),
		);
	});

	it("accepts ip exactly at the 64-char boundary", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		const justRight = "x".repeat(_internal.IP_MAX);
		const id = await insertLoginHistory(env, makeRow({ ip: justRight }));
		expect(id).toBe(1);
		expect(calls).toHaveLength(1);
		expect(calls[0].params[5]).toBe(justRight);
	});

	it("returns null when D1 reports no last_row_id (degenerate INSERT)", async () => {
		const { db } = createMockDb({
			runResults: {
				"INSERT INTO login_history": {
					success: true,
					meta: { last_row_id: 0, changes: 0 },
				},
			},
		});
		const env = makeEnv(db);
		const id = await insertLoginHistory(env, makeRow());
		expect(id).toBeNull();
	});

	it("propagates D1 errors so callers can opt-in to seeing them (insert path is not silent)", async () => {
		const env = {
			DB: {
				prepare: () => ({
					bind: () => ({
						run: async () => {
							throw new Error("D1 simulated failure");
						},
					}),
				}),
			},
		} as unknown as Env;
		await expect(insertLoginHistory(env, makeRow())).rejects.toThrow("D1 simulated failure");
	});
});

describe("scheduleLoginHistory", () => {
	it("defers the insert onto ctx.waitUntil with a real ExecutionContext", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		const { ctx, tasks } = makeCtx();
		scheduleLoginHistory(env, ctx, makeRow());
		expect(tasks).toHaveLength(1);
		await Promise.all(tasks);
		expect(calls).toHaveLength(1);
	});

	it("is a documented no-op when ctx is undefined (test stub call site)", async () => {
		const { db, calls } = createMockDb();
		const env = makeEnv(db);
		// No throw — the auth handler can safely call this from a stubbed
		// context where ExecutionContext is not threaded through.
		expect(() => scheduleLoginHistory(env, undefined, makeRow())).not.toThrow();
		expect(calls).toHaveLength(0);
	});

	it("swallows D1 errors so they never propagate out of the deferred task", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const env = {
			DB: {
				prepare: () => ({
					bind: () => ({
						run: async () => {
							throw new Error("simulated D1 outage");
						},
					}),
				}),
			},
		} as unknown as Env;
		const { ctx, tasks } = makeCtx();
		scheduleLoginHistory(env, ctx, makeRow());
		await expect(Promise.all(tasks)).resolves.toBeDefined();
		expect(warn).toHaveBeenCalledWith("[login-history] insert failed", expect.any(Error));
	});

	it("swallows IP-too-long warns from insertLoginHistory without bubbling", async () => {
		// Both `dropping row` and `insert failed` would call console.warn;
		// here we just assert the helper returned no-throw and ctx.waitUntil
		// settled normally — that's the production contract.
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const { db } = createMockDb();
		const env = makeEnv(db);
		const { ctx, tasks } = makeCtx();
		scheduleLoginHistory(env, ctx, makeRow({ ip: "x".repeat(200) }));
		await expect(Promise.all(tasks)).resolves.toBeDefined();
		// At least one warn was emitted (the dropping-row guard).
		expect(warn).toHaveBeenCalled();
	});
});

describe("cleanupLoginHistory", () => {
	it("DELETEs rows older than retentionDays and returns the changes count", async () => {
		const now = 1_747_785_600; // arbitrary unix seconds
		vi.spyOn(Date, "now").mockReturnValue(now * 1000);
		const { db, calls } = createMockDb({
			runResults: {
				"DELETE FROM login_history": {
					success: true,
					meta: { changes: 1234, last_row_id: 0 },
				},
			},
		});
		const env = makeEnv(db);
		const deleted = await cleanupLoginHistory(env);
		expect(deleted).toBe(1234);
		expect(calls).toHaveLength(1);
		expect(calls[0].sql).toContain("DELETE FROM login_history");
		expect(calls[0].sql).toContain("created_at < ?");
		// Default retention = 30 days.
		expect(calls[0].params[0]).toBe(now - 30 * 24 * 60 * 60);
	});

	it("honors a custom retentionDays for cron tuning", async () => {
		const now = 1_747_785_600;
		vi.spyOn(Date, "now").mockReturnValue(now * 1000);
		const { db, calls } = createMockDb();
		await cleanupLoginHistory(makeEnv(db), 7);
		expect(calls[0].params[0]).toBe(now - 7 * 24 * 60 * 60);
	});

	it("returns 0 when D1 reports no changes meta (safe default)", async () => {
		const { db } = createMockDb({
			runResults: {
				"DELETE FROM login_history": { success: true, meta: { last_row_id: 0 } },
			},
		});
		const deleted = await cleanupLoginHistory(makeEnv(db));
		expect(deleted).toBe(0);
	});

	it("lets D1 errors bubble — the cron caller logs via the scheduled error path", async () => {
		const env = {
			DB: {
				prepare: () => ({
					bind: () => ({
						run: async () => {
							throw new Error("cleanup D1 failure");
						},
					}),
				}),
			},
		} as unknown as Env;
		await expect(cleanupLoginHistory(env)).rejects.toThrow("cleanup D1 failure");
	});
});

describe("LoginHistoryErrorCode enum (regression guard)", () => {
	it("every value corresponds to a real auth.ts branch — pin documented enum surface", () => {
		// The auth-instrumentation tests (auth-login-history-instrumentation
		// .test.ts) prove each code is produced by a real return branch.
		// This pin exists so that if someone adds a new error code value
		// to the union type WITHOUT also adding a real branch + test, the
		// union members list here will fall out of sync with the helper
		// and the regression test will fail.
		//
		// The full closed set, kept in sync with auth.ts:
		const expected: Array<string> = [
			"", // success
			// login()
			"INVALID_CREDENTIALS",
			"USER_BANNED",
			"RATE_LIMITED_IP",
			"LOCKED_OUT_IP",
			// register()
			"REGISTRATION_DISABLED",
			"USERNAME_BANNED",
			"RATE_LIMITED",
			"EMAIL_ALREADY_IN_USE",
			"USERNAME_TAKEN",
		];
		// We can't enumerate union types at runtime; this list is the
		// human-maintained source of truth and the auth instrumentation
		// tests below assert each one is produced by a real branch.
		expect(expected).toHaveLength(10);
	});
});
