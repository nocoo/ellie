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
import { readingFixture } from "./thread-cache-fixture";

const START = Date.parse("2026-09-17T12:00:00Z");
const HOUR = 3_600_000;

beforeEach(() => {
	__resetMetricsForTest();
	vi.useFakeTimers();
	vi.setSystemTime(START);
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
	it("persists core costs and hit rates, with detail rows only on explicit diagnosis", async () => {
		const f = readingFixture();
		try {
			const ops = [
				"read",
				"write",
				"bump",
				"delete",
				"hit",
				"miss",
				"kv-get",
				"kv-put",
				"error",
				"d1-rows-read",
			] as const;
			for (const op of ops) recordKvOp("thread:entity", op);
			expect(await flushSnapshot(f.env, swapSnapshot())).toBe(6);
			const rows = f.sqlite.prepare("SELECT op FROM kv_cache_metrics_hour").all();
			expect(rows.map((row) => row.op).sort()).toEqual([
				"d1-rows-read",
				"error",
				"hit",
				"kv-get",
				"kv-put",
				"miss",
			]);
			for (const op of ops) recordKvOp("thread:entity", op);
			expect(await flushSnapshot({ ...f.env, CACHE_METRICS_DETAIL: "true" }, swapSnapshot())).toBe(
				10,
			);
		} finally {
			f.close();
		}
	});

	it("keeps occupancy gauges as per-hour MAX and flushes them with MAX not SUM", async () => {
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
	it("accumulates an hour without D1, then flushes completed hours once per hour and retains the active hour", async () => {
		const f = readingFixture();
		const ctx = createMockCtx();
		try {
			for (let minute = 0; minute < 60; minute++) {
				vi.setSystemTime(START + minute * 60_000);
				recordHit("thread:entity");
				recordGauge("footprint:thread:entity", "observed-keys", minute);
				scheduleMetricsFlush(f.env, ctx);
				flushPendingNow(f.env, ctx);
			}
			expect(ctx.waitUntil).not.toHaveBeenCalled();
			expect(f.calls).toHaveLength(0);
			vi.setSystemTime(START + HOUR);
			recordHit("thread:entity");
			scheduleMetricsFlush(f.env, ctx);
			await Promise.all(ctx._waitUntilPromises);
			expect(ctx.waitUntil).toHaveBeenCalledOnce();
			const rows = () =>
				f.sqlite
					.prepare(
						"SELECT family, ts_hour, op, count FROM kv_cache_metrics_hour ORDER BY ts_hour, family",
					)
					.all();
			expect(rows()).toEqual([
				{
					family: "footprint:thread:entity",
					ts_hour: START / HOUR,
					op: "observed-keys",
					count: 59,
				},
				{ family: "thread:entity", ts_hour: START / HOUR, op: "hit", count: 60 },
			]);
			for (let minute = 0; minute < 60; minute++) {
				vi.setSystemTime(START + HOUR + minute * 60_000);
				recordHit("thread:entity");
				flushPendingNow(f.env, ctx);
			}
			expect(ctx.waitUntil).toHaveBeenCalledOnce();
			vi.setSystemTime(START + 2 * HOUR);
			scheduleMetricsFlush(f.env, ctx);
			await Promise.all(ctx._waitUntilPromises);
			expect(ctx.waitUntil).toHaveBeenCalledTimes(2);
			expect(rows().at(-1)).toEqual({
				family: "thread:entity",
				ts_hour: START / HOUR + 1,
				op: "hit",
				count: 61,
			});
			expect(f.calls).toHaveLength(3); // One counter batch/hour; one occupancy batch in the first hour.
			expect(f.calls.every((call) => call.sql.includes("INSERT INTO kv_cache_metrics_hour"))).toBe(
				true,
			);
			expect(f.sqlite.prepare("SELECT COUNT(*) AS n FROM kv_cache_metrics_minute").get()?.n).toBe(
				0,
			);
			vi.setSystemTime(START + 5 * HOUR);
			scheduleMetricsFlush(f.env, ctx);
			expect(ctx.waitUntil).toHaveBeenCalledTimes(2); // Idle hours are gaps, not synthetic zero points.
		} finally {
			f.close();
		}
	});

	it("merges multiple isolate observations into one hourly point, summing counters and taking gauge peaks", async () => {
		const f = readingFixture();
		try {
			for (const amount of [4, 9, 2]) {
				recordKvOp("application:d1", "d1-rows-read", amount);
				recordGauge("footprint:thread:entity", "observed-keys", amount);
				await flushSnapshot(f.env, swapSnapshot());
			}
			expect(
				f.sqlite.prepare("SELECT family, count FROM kv_cache_metrics_hour ORDER BY family").all(),
			).toEqual([
				{ family: "application:d1", count: 15 },
				{ family: "footprint:thread:entity", count: 9 },
			]);
		} finally {
			f.close();
		}
	});
});
