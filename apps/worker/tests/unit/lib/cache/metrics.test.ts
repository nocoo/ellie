// Tests for the in-isolate KV cache metrics accumulator.
//
// Focus:
//   1. recordHit / recordMiss / recordError accumulate per family per minute.
//   2. swapSnapshot detaches the in-flight buckets atomically — concurrent
//      record* calls during a flush land in the new (empty) Map.
//   3. flushSnapshot writes one UPSERT per (family, ts_minute) pair and
//      swallows D1 errors (best-effort).
//   4. scheduleMetricsFlush is throttled per isolate.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetMetricsForTest,
	flushSnapshot,
	recordError,
	recordHit,
	recordMiss,
	scheduleMetricsFlush,
	swapSnapshot,
} from "../../../../src/lib/cache/metrics";
import { createMockCtx, makeEnv } from "../../../helpers";

afterEach(() => {
	__resetMetricsForTest();
	vi.useRealTimers();
});

describe("metrics — accumulator", () => {
	it("sums hits/misses/errors per family in the same minute bucket", () => {
		recordHit("forum:tree:v2");
		recordHit("forum:tree:v2");
		recordMiss("forum:tree:v2");
		recordError("user:mini:v1");

		const snap = swapSnapshot();
		expect(snap.size).toBe(2);
		const treeKey = [...snap.keys()].find((k) => k.startsWith("forum:tree:v2:"));
		const userKey = [...snap.keys()].find((k) => k.startsWith("user:mini:v1:"));
		expect(treeKey).toBeTruthy();
		expect(userKey).toBeTruthy();
		expect(snap.get(treeKey as string)).toEqual({ hits: 2, misses: 1, errors: 0 });
		expect(snap.get(userKey as string)).toEqual({ hits: 0, misses: 0, errors: 1 });
	});

	it("swapSnapshot clears the live accumulator atomically", () => {
		recordHit("forum:summary:v2");
		const first = swapSnapshot();
		expect(first.size).toBe(1);
		// New record after swap lands in a fresh bucket map, not into `first`.
		recordHit("forum:summary:v2");
		const second = swapSnapshot();
		expect(second.size).toBe(1);
		// They are independent maps.
		expect(first).not.toBe(second);
	});
});

describe("metrics — flushSnapshot D1 contract", () => {
	it("emits one UPSERT per bucket and swallows row-level failures", async () => {
		const calls: { sql: string; params: unknown[] }[] = [];
		const env = makeEnv({
			DB: {
				prepare: vi.fn((sql: string) => ({
					bind: vi.fn((...params: unknown[]) => ({
						run: vi.fn(async () => {
							calls.push({ sql, params });
							// First row throws; second row succeeds — verify the
							// flush keeps going past the failure.
							if (calls.length === 1) throw new Error("D1 transient");
							return { success: true };
						}),
					})),
				})),
			} as unknown as D1Database,
		});

		recordHit("forum:tree:v2");
		recordMiss("forum:summary:v2");
		const snap = swapSnapshot();
		const attempted = await flushSnapshot(env, snap);

		expect(attempted).toBe(2);
		expect(calls).toHaveLength(2);
		// Both UPSERTs hit the metrics table.
		expect(calls[0].sql).toContain("kv_cache_metrics_minute");
	});

	it("returns 0 attempted when snapshot is empty", async () => {
		const env = makeEnv();
		const attempted = await flushSnapshot(env, new Map());
		expect(attempted).toBe(0);
	});
});

describe("metrics — scheduleMetricsFlush throttle", () => {
	it("first call arms the clock without flushing; later calls flush after interval", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-11T08:00:00Z"));

		const env = makeEnv();
		const ctx = createMockCtx();
		recordHit("forum:tree:v2");

		// First call: no flush yet (clock arming).
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).not.toHaveBeenCalled();

		// 10s later: still under the 30s interval.
		vi.advanceTimersByTime(10_000);
		recordHit("forum:tree:v2");
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).not.toHaveBeenCalled();

		// 31s later: interval elapsed → flush scheduled.
		vi.advanceTimersByTime(21_000);
		recordHit("forum:tree:v2");
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledOnce();
	});

	it("no-op when nothing is pending", () => {
		const env = makeEnv();
		const ctx = createMockCtx();
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).not.toHaveBeenCalled();
	});
});
