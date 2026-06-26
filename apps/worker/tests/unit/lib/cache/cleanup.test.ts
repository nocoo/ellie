// cleanup.test.ts — retention sweep boundary tests for kv_cache_metrics_minute.
//
// Pins:
//   1. Default retention window is 7 days; cutoff = floor(nowSec/60) - 7*1440.
//   2. Explicit retentionDays is respected.
//   3. Cutoff is in MINUTES (matching ts_minute's unit), not seconds — a
//      seconds-based cutoff would nuke the whole table.
//   4. Invalid retentionDays (<=0, NaN, Infinity) → 0 and NO D1 op
//      (the helper must refuse to truncate the table by accident).
//   5. Returns `meta.changes` as a number (D1 sometimes returns BigInt).
//   6. SQL targets kv_cache_metrics_minute and compares ts_minute to the
//      bound cutoff — never touches other tables.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cleanupKvCacheMetricsMinute,
	DEFAULT_RETENTION_DAYS,
} from "../../../../src/lib/cache/cleanup";
import { makeEnv } from "../../../helpers";

interface DbCall {
	sql: string;
	bound: unknown[];
}

function makeMockDb(metaChanges: number | bigint = 0) {
	const calls: DbCall[] = [];
	const prepare = vi.fn((sql: string) => {
		const call: DbCall = { sql, bound: [] };
		const stmt = {
			bind: vi.fn((...args: unknown[]) => {
				call.bound = args;
				calls.push(call);
				return stmt;
			}),
			run: vi.fn(async () => ({ meta: { changes: metaChanges } })),
		};
		return stmt;
	});
	const db = { prepare } as unknown as D1Database;
	return { db, prepare, calls };
}

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DEFAULT_RETENTION_DAYS", () => {
	it("is 7 days", () => {
		expect(DEFAULT_RETENTION_DAYS).toBe(7);
	});
});

describe("cleanupKvCacheMetricsMinute", () => {
	it("default cutoff is floor(nowSec/60) - 7*1440 minutes", async () => {
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		const nowSec = 1_747_800_000;
		const nowMinute = Math.floor(nowSec / 60);
		await cleanupKvCacheMetricsMinute(env, undefined, nowSec);
		expect(calls).toHaveLength(1);
		expect(calls[0].bound).toEqual([nowMinute - 7 * 1440]);
	});

	it("explicit retentionDays is honored", async () => {
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		const nowSec = 1_747_800_000;
		const nowMinute = Math.floor(nowSec / 60);
		await cleanupKvCacheMetricsMinute(env, 3, nowSec);
		expect(calls[0].bound).toEqual([nowMinute - 3 * 1440]);
	});

	it("cutoff is in minutes (not seconds) — guards against unit mix-up", async () => {
		// Sanity bound: cutoff for any sane retention must be << nowSec, but
		// MUST be on the order of nowMinute. Asserting an exact equality
		// catches a seconds-based cutoff regression where the value would be
		// ~60× larger.
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		const nowSec = 1_747_800_000;
		await cleanupKvCacheMetricsMinute(env, 1, nowSec);
		const cutoff = calls[0].bound[0] as number;
		// nowMinute - 1*1440 ≈ 29128560
		expect(cutoff).toBeLessThan(nowSec / 50);
		expect(cutoff).toBeGreaterThan(nowSec / 70);
	});

	it("SQL deletes from kv_cache_metrics_minute keyed on ts_minute", async () => {
		const { db, calls } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		await cleanupKvCacheMetricsMinute(env, 7, 1_747_800_000);
		expect(calls[0].sql).toMatch(/DELETE\s+FROM\s+kv_cache_metrics_minute/i);
		expect(calls[0].sql).toMatch(/WHERE\s+ts_minute\s*<\s*\?/i);
	});

	it("returns meta.changes as a number", async () => {
		const { db } = makeMockDb(123);
		const env = makeEnv({ DB: db });
		const n = await cleanupKvCacheMetricsMinute(env, 7, 1_747_800_000);
		expect(n).toBe(123);
		expect(typeof n).toBe("number");
	});

	it("coerces BigInt meta.changes to number", async () => {
		const { db } = makeMockDb(99n);
		const env = makeEnv({ DB: db });
		const n = await cleanupKvCacheMetricsMinute(env, 7, 1_747_800_000);
		expect(n).toBe(99);
		expect(typeof n).toBe("number");
	});

	it("retentionDays <= 0 → 0 and NO D1 op (refuses to truncate)", async () => {
		const { db, prepare } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		expect(await cleanupKvCacheMetricsMinute(env, 0, 1_747_800_000)).toBe(0);
		expect(await cleanupKvCacheMetricsMinute(env, -5, 1_747_800_000)).toBe(0);
		expect(prepare).not.toHaveBeenCalled();
	});

	it("non-finite retentionDays → 0 and NO D1 op", async () => {
		const { db, prepare } = makeMockDb(0);
		const env = makeEnv({ DB: db });
		expect(await cleanupKvCacheMetricsMinute(env, Number.NaN, 1_747_800_000)).toBe(0);
		expect(await cleanupKvCacheMetricsMinute(env, Number.POSITIVE_INFINITY, 1_747_800_000)).toBe(0);
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
		expect(await cleanupKvCacheMetricsMinute(env, 7, 1_747_800_000)).toBe(0);
	});
});
