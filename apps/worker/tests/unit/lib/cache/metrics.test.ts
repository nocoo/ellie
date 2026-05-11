// Tests for the in-isolate KV cache op-metrics accumulator (B.1).
//
// Focus:
//   1. recordKvOp accumulates per family per op per minute.
//   2. swapSnapshot detaches the in-flight buckets atomically — concurrent
//      record* calls during a flush land in the new (empty) Map.
//   3. flushSnapshot writes one UPSERT per (family, ts_minute, op) and
//      swallows D1 errors (best-effort).
//   4. scheduleMetricsFlush flushes immediately on first observation,
//      then throttles to one flush per FLUSH_INTERVAL_MS.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetMetricsForTest,
	flushSnapshot,
	recordBump,
	recordDelete,
	recordError,
	recordHit,
	recordKvOp,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
	swapSnapshot,
} from "../../../../src/lib/cache/metrics";
import { createMockCtx, makeEnv } from "../../../helpers";

afterEach(() => {
	__resetMetricsForTest();
	vi.useRealTimers();
});

describe("metrics — accumulator", () => {
	it("sums per family per op in the same minute bucket", () => {
		recordRead("forum:tree:v2");
		recordHit("forum:tree:v2");
		recordRead("forum:tree:v2");
		recordHit("forum:tree:v2");
		recordRead("forum:tree:v2");
		recordMiss("forum:tree:v2");
		recordWrite("forum:tree:v2");
		recordError("user:mini:v1");
		recordBump("thread:list:v2");
		recordDelete("user:mini:v1");

		const snap = swapSnapshot();
		// 7 distinct (family, op) tuples in one minute.
		expect(snap.size).toBe(7);
		// All values are positive integers.
		for (const v of snap.values()) {
			expect(v).toBeGreaterThan(0);
		}
		// Sum across forum:tree:v2 reads should be 3.
		const treeReadKey = [...snap.keys()].find(
			(k) => k.startsWith("forum:tree:v2") && k.endsWith("read"),
		);
		expect(treeReadKey).toBeTruthy();
		expect(snap.get(treeReadKey as string)).toBe(3);
	});

	it("recordKvOp ignores unknown ops", () => {
		// @ts-expect-error — exercising the runtime guard
		recordKvOp("forum:tree:v2", "frob");
		const snap = swapSnapshot();
		expect(snap.size).toBe(0);
	});

	it("swapSnapshot clears the live accumulator atomically", () => {
		recordHit("forum:summary:v2");
		const first = swapSnapshot();
		expect(first.size).toBe(1);
		// New record after swap lands in a fresh bucket map, not into `first`.
		recordHit("forum:summary:v2");
		const second = swapSnapshot();
		expect(second.size).toBe(1);
		expect(first).not.toBe(second);
	});
});

describe("metrics — flushSnapshot D1 contract", () => {
	it("emits one UPSERT per (family, ts, op) and swallows row-level failures", async () => {
		const calls: { sql: string; params: unknown[] }[] = [];
		const env = makeEnv({
			DB: {
				prepare: vi.fn((sql: string) => ({
					bind: vi.fn((...params: unknown[]) => ({
						run: vi.fn(async () => {
							calls.push({ sql, params });
							// First row throws; subsequent succeed — verify the
							// flush keeps going past the failure.
							if (calls.length === 1) throw new Error("D1 transient");
							return { success: true };
						}),
					})),
				})),
			} as unknown as D1Database,
		});

		recordRead("forum:tree:v2");
		recordHit("forum:tree:v2");
		recordWrite("forum:summary:v2");
		const snap = swapSnapshot();
		const attempted = await flushSnapshot(env, snap);

		expect(attempted).toBe(3);
		expect(calls).toHaveLength(3);
		// Each UPSERT carries the op as the third bound param (after family,
		// ts_minute) and an integer count as the fourth.
		for (const c of calls) {
			expect(c.sql).toContain("kv_cache_metrics_minute");
			expect(c.params).toHaveLength(4);
			expect(typeof c.params[2]).toBe("string");
			expect(typeof c.params[3]).toBe("number");
		}
	});

	it("returns 0 attempted when snapshot is empty", async () => {
		const env = makeEnv();
		const attempted = await flushSnapshot(env, new Map());
		expect(attempted).toBe(0);
	});
});

describe("metrics — scheduleMetricsFlush throttle", () => {
	it("first call flushes immediately; calls inside the throttle window are no-ops", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-11T08:00:00Z"));

		const env = makeEnv();
		const ctx = createMockCtx();
		recordHit("forum:tree:v2");

		// First call: flush even on the very first observation so low-traffic
		// paths still surface metrics.
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledOnce();

		// 10s later: still under the 30s interval → no second flush.
		vi.advanceTimersByTime(10_000);
		recordHit("forum:tree:v2");
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledOnce();

		// 31s later: interval elapsed → flush scheduled again.
		vi.advanceTimersByTime(21_000);
		recordHit("forum:tree:v2");
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
	});

	it("no-op when nothing is pending", () => {
		const env = makeEnv();
		const ctx = createMockCtx();
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).not.toHaveBeenCalled();
	});
});
