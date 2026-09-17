import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetMetricsForTest,
	flushPendingNow,
	flushSnapshot,
	recordBump,
	recordDelete,
	recordError,
	recordGauge,
	recordHit,
	recordKvOp,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
	swapSnapshot,
} from "../../../../src/lib/cache/metrics";
import { createMockCtx, createMockDb, makeEnv } from "../../../helpers";

beforeEach(() => {
	__resetMetricsForTest();
	vi.useFakeTimers();
	vi.setSystemTime(1_700_000_000_000);
});
afterEach(() => {
	__resetMetricsForTest();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("bounded cache and D1 observation windows", () => {
	it("keeps independent dimensions and atomically detaches a snapshot", () => {
		recordRead("thread:entity");
		recordRead("thread:entity");
		recordHit("thread:entity");
		recordMiss("thread:entity");
		recordWrite("thread:entity");
		recordError("thread:entity");
		recordBump("thread:entity");
		recordDelete("thread:entity");
		recordKvOp("application:d1", "d1-rows-read", 37);
		const snapshot = swapSnapshot();
		expect(snapshot.size).toBe(8);
		expect([...snapshot.entries()].find(([key]) => key.endsWith("\u0001read"))?.[1]).toBe(2);
		expect([...snapshot.entries()].find(([key]) => key.includes("d1-rows-read"))?.[1]).toBe(37);
		recordHit("thread:entity");
		expect([...swapSnapshot().values()]).toEqual([1]);
		expect(snapshot.size).toBe(8);
	});
	it("ignores unsupported operations and invalid amounts; admission holds at 512 dimensions", () => {
		// @ts-expect-error deliberate invalid operation
		recordKvOp("x", "invalid");
		for (const n of [-1, NaN, Infinity]) recordKvOp("x", "hit", n);
		expect(swapSnapshot().size).toBe(0);
		for (let i = 0; i < 1000; i++) recordKvOp(`f${i}`, "hit");
		recordKvOp("f0", "hit");
		const snapshot = swapSnapshot();
		expect(snapshot.size).toBe(512);
		expect([...snapshot.values()].filter((n) => n === 2)).toHaveLength(1);
	});
	it("writes at most 25 metric rows per statement and continues after a failed batch without retry", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		let calls = 0;
		const binds: unknown[][] = [];
		vi.mocked(db.prepare).mockImplementation(
			(_sql) =>
				({
					bind: (...params: unknown[]) => {
						binds.push(params);
						return {
							run: async () => {
								if (++calls === 1) throw new Error("D1 unavailable");
								return { success: true };
							},
						};
					},
				}) as D1PreparedStatement,
		);
		for (let i = 0; i < 61; i++) recordHit(`f${i}`);
		const snapshot = swapSnapshot();
		snapshot.set("corrupt", 1);
		snapshot.set("f\u0001NaN\u0001hit", 1);
		snapshot.set("f\u00011\u0001unknown", 1);
		expect(await flushSnapshot(env, snapshot)).toBe(61);
		expect(binds.map((params) => params.length)).toEqual([100, 100, 44]);
		expect(warn).toHaveBeenCalledOnce();
		expect(await flushSnapshot(env, new Map())).toBe(0);
	});
	it("keeps occupancy gauges as per-minute MAX and flushes them with MAX not SUM", async () => {
		recordGauge("footprint:thread:list", "observed-keys", 4);
		recordGauge("footprint:thread:list", "observed-keys", 9);
		recordGauge("footprint:thread:list", "observed-bytes", 100);
		recordKvOp("footprint:thread:list", "observed-bytes", 40);
		const snapshot = swapSnapshot();
		expect([...snapshot.values()].sort((a, b) => a - b)).toEqual([9, 100]);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const sql: string[] = [];
		vi.mocked(db.prepare).mockImplementation((text) => {
			sql.push(text);
			return { bind: () => ({ run: async () => ({ success: true }) }) } as D1PreparedStatement;
		});
		expect(await flushSnapshot(env, snapshot)).toBe(2);
		expect(sql.some((text) => text.includes("MAX(count, excluded.count)"))).toBe(true);
		expect(sql.some((text) => text.includes("count = count + excluded.count"))).toBe(false);
	});
	it("never flushes at first observation or after fills; every window is at least 60 seconds", async () => {
		const env = makeEnv({ DB: createMockDb().db });
		const ctx = createMockCtx();
		scheduleMetricsFlush(env, ctx);
		flushPendingNow(env, ctx);
		recordHit("thread:entity");
		scheduleMetricsFlush(env, ctx);
		flushPendingNow(env, ctx);
		vi.advanceTimersByTime(59_999);
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledOnce();
		recordWrite("thread:entity");
		flushPendingNow(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(60_000);
		scheduleMetricsFlush(env, ctx);
		expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
		await Promise.all(ctx._waitUntilPromises);
		expect(env.DB.prepare).toHaveBeenCalledTimes(2);
	});
});
