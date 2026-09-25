import { DAILY_STATISTICS_PATH, type DailyStatistics, STATISTICS_WRITE_HEADER } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { statisticsSnapshotHandler } from "../../../src/handlers/internal/statisticsSnapshot";
import { invalidateThreadListForForums } from "../../../src/lib/cache/invalidate";
import {
	DAILY_STATISTICS_KEY,
	readDailyStatistics,
	recordStatisticsDelta,
	refreshDailyStatistics,
} from "../../../src/lib/daily-statistics";
import { markStatisticsForums, readChangedForums } from "../../../src/lib/recent-activity";
import {
	incrementStatsOnPostCreate,
	incrementStatsOnThreadCreate,
	incrementStatsOnUserRegister,
} from "../../../src/lib/stats-counter";
import { readingFixture } from "./cache/thread-cache-fixture";

const NOW = Date.parse("2026-09-25T02:00:00Z");
const START = Date.parse("2026-09-24T16:00:00Z") / 1000;

describe("daily statistics persistence", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		f = readingFixture();
	});
	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("bootstraps the baseline once and bounds daily posts by indexed Shanghai dates", async () => {
		f.insert("forums", { id: 0, name: "Deleted", status: 0, posts: 67_161 });
		f.thread(6, { forum_id: 0, created_at: START - 1 });
		f.thread(1, { type_id: 9, created_at: START });
		f.thread(2, { type_id: 9, sticky: 2, created_at: START + 1 });
		f.thread(3, { type_id: 9, sticky: -1, created_at: START + 1 });
		f.thread(4, { forum_id: 2, created_at: START - 1 });
		f.sqlite.exec("PRAGMA foreign_keys=OFF");
		f.thread(5, { forum_id: 999 });
		f.sqlite.exec(
			"UPDATE forums SET posts=100 WHERE id=1; UPDATE settings SET value='120' WHERE key='stats.total_threads'",
		);
		for (const [i, offset] of [-86_401, -86_400, -1, 0, 86_399, 86_400].entries())
			f.post(i + 1, { created_at: START + offset });
		const data = await refreshDailyStatistics(f.env);
		expect(data.forums[0]).toEqual({
			threads: 1,
			posts: 67_161,
			todayThreads: 0,
			types: { "0": 1 },
		});
		expect(data.forums[1]).toEqual({ threads: 1, posts: 100, todayThreads: 2, types: { "9": 2 } });
		expect(data.forums[2]).toEqual({ threads: 1, posts: 0, todayThreads: 0, types: { "0": 1 } });
		expect(data.forums[999]).toBeUndefined();
		expect(data.stats).toMatchObject({ totalThreads: 120, todayPosts: 2, yesterdayPosts: 2 });
		expect(f.calls).toHaveLength(6);
		expect(f.calls.find((c) => c.sql.includes("FROM posts"))?.sql).toContain(
			"INDEXED BY idx_posts_created",
		);
		expect(f.env.KV.put).toHaveBeenCalledWith(DAILY_STATISTICS_KEY, JSON.stringify(data));
	});

	it("serves old and missing snapshots without any foreground D1 query", async () => {
		expect(await readDailyStatistics(f.env)).toBeNull();
		await recordStatisticsDelta(f.env, { kind: "thread", forumId: 1 });
		expect(f.calls).toHaveLength(0);
		const data = await refreshDailyStatistics(f.env);
		const calls = f.calls.length;
		vi.setSystemTime(NOW + 3 * 86_400_000);
		expect((await readDailyStatistics(f.env))?.version).toBe(data.version);
		expect(f.calls).toHaveLength(calls);
	});

	it("persists optimistic changes without overwriting a newly published base", async () => {
		const first = await refreshDailyStatistics(f.env);
		const calls = f.calls.length;
		await recordStatisticsDelta(f.env, { kind: "thread", forumId: 1, typeId: 8 });
		await recordStatisticsDelta(f.env, { kind: "post", forumId: 1 });
		await recordStatisticsDelta(f.env, { kind: "member" });
		expect((await readDailyStatistics(f.env))?.stats).toMatchObject({
			totalThreads: 1,
			totalPosts: 2,
			totalMembers: 1,
		});
		expect(f.calls).toHaveLength(calls);
		expect(JSON.parse(f.values.get(DAILY_STATISTICS_KEY) ?? "null")).toEqual(first);
		const oldDelta = f.values.get(`${DAILY_STATISTICS_KEY}:delta:${first.version}`);
		const second = await refreshDailyStatistics(f.env);
		f.values.set(`${DAILY_STATISTICS_KEY}:delta:${first.version}`, oldDelta ?? "null");
		expect((await readDailyStatistics(f.env))?.version).toBe(second.version);
		expect((await readDailyStatistics(f.env))?.stats.totalThreads).toBe(0);
	});

	it("does not apply malformed or cross-generation optimistic snapshots", async () => {
		const base = await refreshDailyStatistics(f.env);
		const key = `${DAILY_STATISTICS_KEY}:delta:${base.version}`;
		for (const value of [
			null,
			{},
			{ ...base, version: `${NOW + 1}-00000000-0000-0000-0000-000000000000` },
			{ ...base, generatedAt: NOW - 1 },
		]) {
			f.values.set(key, JSON.stringify(value));
			expect(await readDailyStatistics(f.env)).toEqual(base);
		}
		f.values.set(DAILY_STATISTICS_KEY, "{}");
		expect(await readDailyStatistics(f.env)).toBeNull();
	});

	it("preserves the last complete snapshot when aggregation or publication fails", async () => {
		const base = await refreshDailyStatistics(f.env);
		f.state.queryError = true;
		await expect(refreshDailyStatistics(f.env)).rejects.toThrow("refresh failed");
		f.state.queryError = false;
		f.sqlite.exec("UPDATE settings SET value='-1' WHERE key='stats.total_threads'");
		await expect(refreshDailyStatistics(f.env)).rejects.toThrow("aggregation was invalid");
		f.sqlite.exec("UPDATE settings SET value='0' WHERE key='stats.total_threads'");
		f.state.writeError = true;
		await expect(refreshDailyStatistics(f.env)).rejects.toThrow("KV 429");
		expect(JSON.parse(f.values.get(DAILY_STATISTICS_KEY) ?? "null")).toEqual(base);
	});

	it("keeps successful business counters when optimistic KV fails", async () => {
		await refreshDailyStatistics(f.env);
		f.state.writeError = true;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		await incrementStatsOnThreadCreate(f.env, 1, 8);
		await incrementStatsOnPostCreate(f.env, 1);
		await incrementStatsOnUserRegister(f.env);
		expect(
			f.sqlite.prepare("SELECT value FROM settings WHERE key='stats.total_posts'").get(),
		).toMatchObject({ value: "2" });
		expect(warn).toHaveBeenCalledTimes(5);
		f.state.readError = true;
		expect(await readDailyStatistics(f.env)).toBeNull();
		await expect(recordStatisticsDelta(f.env, { kind: "member" })).resolves.toBeUndefined();
	});

	it("requires the dedicated internal secret before reading or refreshing", async () => {
		const request = (method: string, key?: string) =>
			new Request(`https://worker.test${DAILY_STATISTICS_PATH}`, {
				method,
				headers: key ? { [STATISTICS_WRITE_HEADER]: key } : {},
			});
		expect((await statisticsSnapshotHandler(request("DELETE"), f.env)).status).toBe(405);
		expect((await statisticsSnapshotHandler(request("GET"), f.env)).status).toBe(503);
		f.env.WEB_STATISTICS_WRITE_KEY = "dedicated";
		for (const key of [undefined, "wrong", f.env.API_KEY])
			expect((await statisticsSnapshotHandler(request("POST", key), f.env)).status).toBe(401);
		expect(f.calls).toHaveLength(0);
		const empty = await statisticsSnapshotHandler(request("GET", "dedicated"), f.env);
		expect(await empty.json()).toEqual({ data: null });
		const refreshed = await statisticsSnapshotHandler(request("POST", "dedicated"), f.env);
		expect(refreshed.status).toBe(200);
		expect(refreshed.headers.get("cache-control")).toBe("no-store");
		const body = (await refreshed.json()) as { data: DailyStatistics };
		const read = await statisticsSnapshotHandler(request("GET", "dedicated"), f.env);
		expect(await read.json()).toEqual(body);
		f.state.queryError = true;
		expect((await statisticsSnapshotHandler(request("POST", "dedicated"), f.env)).status).toBe(503);
	});
	it("skips historical thread counts on a quiet day and retains all unaffected type totals", async () => {
		f.thread(1, { forum_id: 1, type_id: 8 });
		f.thread(2, { forum_id: 2, type_id: 9 });
		const first = await refreshDailyStatistics(f.env);
		f.calls.length = 0;
		vi.setSystemTime(NOW + 86_400_000);
		const next = await refreshDailyStatistics(f.env);
		expect(next.forums).toEqual(first.forums);
		expect(f.calls).toHaveLength(5);
		expect(f.calls.some((call) => call.sql.includes("COUNT(*) AS threads"))).toBe(false);
		expect(f.calls.filter((call) => call.sql.includes("FROM threads"))).toHaveLength(1);
	});

	it("corrects only recent or marked forums using index searches and resets today counts", async () => {
		f.thread(1, { forum_id: 1, type_id: 8, created_at: START + 1 });
		f.thread(2, { forum_id: 2, type_id: 9 });
		const first = await refreshDailyStatistics(f.env);
		f.thread(3, { forum_id: 1, type_id: 8, last_post_at: NOW / 1000, created_at: START + 2 });
		f.calls.length = 0;
		const next = await refreshDailyStatistics(f.env);
		expect(next.forums[1]).toMatchObject({ threads: 2, todayThreads: 2, types: { "8": 2 } });
		expect(next.forums[2]).toEqual(first.forums[2]);
		const query = f.calls.find((call) => call.sql.includes("COUNT(*) AS threads"));
		expect(query?.params[2]).toBe("[1]");
		if (!query) throw new Error("Missing changed-forum count query");
		const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params);
		expect(JSON.stringify(plan)).toContain("SEARCH threads USING INDEX idx_threads_forum");
		vi.setSystemTime(NOW + 86_400_000);
		expect((await refreshDailyStatistics(f.env)).forums[1]).toMatchObject({
			threads: 2,
			todayThreads: 0,
		});
	});

	it("corrects both sides of historical moves and deletions from the mutation journal", async () => {
		f.thread(1, { forum_id: 1, type_id: 8 });
		f.thread(2, { forum_id: 1, type_id: 9 });
		await refreshDailyStatistics(f.env);
		f.sqlite.exec(
			"UPDATE threads SET forum_id=2, type_id=0 WHERE id=1; DELETE FROM threads WHERE id=2",
		);
		await invalidateThreadListForForums(f.env, [1, 2]);
		const next = await refreshDailyStatistics(f.env);
		expect(next.forums[1]).toMatchObject({ threads: 0, types: {} });
		expect(next.forums[2]).toMatchObject({ threads: 1, types: { "0": 1 } });
		expect((await readChangedForums(f.env)).forumIds).toEqual([]);
	});

	it("keeps dirty markers after failure and preserves markers arriving during a refresh", async () => {
		await refreshDailyStatistics(f.env);
		await markStatisticsForums(f.env, [1]);
		f.state.writeError = true;
		await expect(refreshDailyStatistics(f.env)).rejects.toThrow("KV 429");
		expect((await readChangedForums(f.env)).keys).toHaveLength(1);
		f.state.writeError = false;
		f.state.afterRead = async (sql) => {
			if (sql.includes("COUNT(*) AS threads")) await markStatisticsForums(f.env, [1]);
		};
		await refreshDailyStatistics(f.env);
		expect((await readChangedForums(f.env)).keys).toHaveLength(1);
	});
});
