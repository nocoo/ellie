// cleanup.test.ts — P5 retention sweep boundary tests.
//
// Pins:
//   1. Default retention window is 48h; cutoff = nowSec - 48*3600.
//   2. Explicit retentionHours is respected.
//   3. Invalid retentionHours (<=0, NaN, Infinity) → 0 and NO D1 op
//      (the helper must refuse to truncate the whole table by accident).
//   4. Returns `meta.changes` as a number (D1 sometimes returns BigInt).
//   5. SQL targets analytics_daily_targets and compares last_seen_at to
//      the bound cutoff — never touches other tables.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cleanupAnalyticsDailyTargets,
	DEFAULT_RETENTION_HOURS,
} from "../../../../src/lib/analytics/cleanup";
import { makeEnv } from "../../../helpers";

interface DbCall {
	sql: string;
	bound: unknown[];
}

function makeMockDb(metaChanges: number | bigint = 0) {
	const calls: DbCall[] = [];
	const runResults: Array<{ meta: { changes: number | bigint } }> = [];
	const prepare = vi.fn((sql: string) => {
		const call: DbCall = { sql, bound: [] };
		const stmt = {
			bind: vi.fn((...args: unknown[]) => {
				call.bound = args;
				calls.push(call);
				return stmt;
			}),
			run: vi.fn(async () => {
				const r = { meta: { changes: metaChanges } };
				runResults.push(r);
				return r;
			}),
		};
		return stmt;
	});
	const db = { prepare } as unknown as D1Database;
	return { db, prepare, calls, runResults };
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DEFAULT_RETENTION_HOURS", () => {
	it("is 48 hours", () => {
		expect(DEFAULT_RETENTION_HOURS).toBe(48);
	});
});

describe("cleanupAnalyticsDailyTargets", () => {
	it("default cutoff is nowSec - 48*3600", async () => {
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		const nowSec = 1_747_800_000;
		await cleanupAnalyticsDailyTargets(env, undefined, nowSec);
		expect(calls).toHaveLength(1);
		expect(calls[0].bound).toEqual([nowSec - 48 * 3600]);
	});

	it("explicit retentionHours is honored", async () => {
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		const nowSec = 1_747_800_000;
		await cleanupAnalyticsDailyTargets(env, 24, nowSec);
		expect(calls[0].bound).toEqual([nowSec - 24 * 3600]);
	});

	it("SQL deletes from analytics_daily_targets keyed on last_seen_at", async () => {
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		await cleanupAnalyticsDailyTargets(env, 48, 1_747_800_000);
		expect(calls[0].sql).toMatch(/DELETE\s+FROM\s+analytics_daily_targets/i);
		expect(calls[0].sql).toMatch(/WHERE\s+last_seen_at\s*<\s*\?/i);
	});

	it("returns meta.changes as a number", async () => {
		const { db } = makeMockDb(7);
		const env = makeEnv({ DB: db });
		const n = await cleanupAnalyticsDailyTargets(env, 48, 1_747_800_000);
		expect(n).toBe(7);
		expect(typeof n).toBe("number");
	});

	it("coerces BigInt meta.changes to number", async () => {
		const { db } = makeMockDb(42n);
		const env = makeEnv({ DB: db });
		const n = await cleanupAnalyticsDailyTargets(env, 48, 1_747_800_000);
		expect(n).toBe(42);
		expect(typeof n).toBe("number");
	});

	it("retentionHours <= 0 → 0 and NO D1 op (refuses to truncate)", async () => {
		const { db, prepare } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		expect(await cleanupAnalyticsDailyTargets(env, 0, 1_747_800_000)).toBe(0);
		expect(await cleanupAnalyticsDailyTargets(env, -5, 1_747_800_000)).toBe(0);
		expect(prepare).not.toHaveBeenCalled();
	});

	it("non-finite retentionHours → 0 and NO D1 op", async () => {
		const { db, prepare } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		expect(await cleanupAnalyticsDailyTargets(env, Number.NaN, 1_747_800_000)).toBe(0);
		expect(await cleanupAnalyticsDailyTargets(env, Number.POSITIVE_INFINITY, 1_747_800_000)).toBe(
			0,
		);
		expect(prepare).not.toHaveBeenCalled();
	});

	it("missing meta.changes defaults to 0", async () => {
		const prepare = vi.fn(() => {
			const stmt = {
				bind: vi.fn().mockReturnThis(),
				run: vi.fn(async () => ({ meta: {} })),
			};
			return stmt;
		});
		const env = makeEnv({ DB: { prepare } as unknown as D1Database });
		expect(await cleanupAnalyticsDailyTargets(env, 48, 1_747_800_000)).toBe(0);
	});
});
