import { type DailyStatistics, EMPTY_HOME_STATS } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DailyStatisticsMemory } from "../../../src/lib/daily-statistics";

const now = Date.parse("2026-09-25T10:00:00+08:00");
function snapshot(at = now): DailyStatistics {
	return {
		version: `${at}-00000000-0000-4000-8000-000000000000`,
		generatedAt: at,
		day: "2026-09-25",
		stats: { ...EMPTY_HOME_STATS, totalThreads: 10, todayPosts: 2 },
		forums: { "2": { threads: 10, posts: 15, todayThreads: 2, types: { "3": 4 } } },
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(now);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("daily statistics memory", () => {
	it("coalesces cold loading and serves warm reads without storage I/O", async () => {
		const load = vi.fn().mockResolvedValue(snapshot());
		const memory = new DailyStatisticsMemory(load);
		const values = await Promise.all([memory.read(), memory.read(), memory.read()]);
		expect(values[0]?.stats.totalThreads).toBe(10);
		expect(load).toHaveBeenCalledTimes(1);
		await memory.read();
		expect(load).toHaveBeenCalledTimes(1);
	});
	it("retains data through refresh failure and rejects older snapshots", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const load = vi
			.fn()
			.mockResolvedValueOnce(snapshot())
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(snapshot(now - 1));
		const memory = new DailyStatisticsMemory(load);
		await memory.read();
		await memory.refresh();
		await memory.refresh();
		expect(memory.peek()?.generatedAt).toBe(now);
	});
	it("projects midnight and applies committed events without recounting", async () => {
		const load = vi.fn().mockResolvedValue(snapshot());
		const memory = new DailyStatisticsMemory(load);
		memory.optimistic({ kind: "thread", forumId: 2 });
		await memory.read();
		memory.optimistic({ kind: "thread", forumId: 2, typeId: 3 });
		expect(memory.peek()?.forums[2].types[3]).toBe(5);
		vi.setSystemTime(Date.parse("2026-09-26T00:01:00+08:00"));
		expect((await memory.read())?.stats).toMatchObject({
			todayPosts: 0,
			yesterdayPosts: 3,
			totalThreads: 11,
		});
		expect(load).toHaveBeenCalledTimes(1);
	});
	it("backs off unavailable data, rejects invalid and oversized snapshots", async () => {
		const load = vi.fn().mockResolvedValue(null);
		const memory = new DailyStatisticsMemory(load);
		expect(await memory.read()).toBeNull();
		await memory.read();
		expect(load).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300_000);
		await memory.read();
		expect(load).toHaveBeenCalledTimes(2);
		load.mockResolvedValue({ ...snapshot(), version: "invalid" });
		await memory.refresh();
		expect(memory.peek()).toBeNull();
		load.mockResolvedValue({ ...snapshot(), unused: "x".repeat(2_097_152) });
		await memory.refresh();
		expect(memory.peek()).toBeNull();
	});
	it("refreshes in the background hourly and stops its timer", async () => {
		const load = vi.fn().mockResolvedValue(snapshot());
		const memory = new DailyStatisticsMemory(load);
		memory.start();
		memory.start();
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(load).toHaveBeenCalledTimes(2);
		memory.stop();
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(load).toHaveBeenCalledTimes(2);
	});
	it("does not fetch without configured credentials", async () => {
		vi.stubEnv("WORKER_API_URL", "");
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "");
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		expect(await new DailyStatisticsMemory().read()).toBeNull();
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("reads only the authenticated bounded snapshot endpoint", async () => {
		vi.stubEnv("WORKER_API_URL", "https://worker.test");
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "fixture-only");
		const fetcher = vi.fn().mockResolvedValue(Response.json({ data: snapshot() }));
		vi.stubGlobal("fetch", fetcher);
		expect((await new DailyStatisticsMemory().read())?.stats.totalThreads).toBe(10);
		expect(String(fetcher.mock.calls[0][0])).toBe(
			"https://worker.test/api/internal/statistics/snapshot",
		);
		expect(fetcher.mock.calls[0][1]).toMatchObject({
			cache: "no-store",
			redirect: "error",
			headers: { "X-Ellie-Statistics-Key": "fixture-only" },
		});
	});
	it.each([
		() => new Response(null, { status: 503 }),
		() => new Response(null),
		() => new Response("not-json"),
		() => Response.json({}),
		() => Response.json({ data: {} }),
		() => Response.json({ data: null }),
		() => new Response("x".repeat(2_097_153)),
	])("fails closed without a database fallback", async (response) => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("WORKER_API_URL", "https://worker.test");
		vi.stubEnv("WEB_STATISTICS_WRITE_KEY", "fixture-only");
		const fetcher = vi.fn().mockResolvedValue(response());
		vi.stubGlobal("fetch", fetcher);
		expect(await new DailyStatisticsMemory().read()).toBeNull();
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
