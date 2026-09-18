import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMetricsForTest } from "../../../../src/lib/cache/metrics";
import {
	countPostsInDay,
	getPublicStats,
	isPublicStats,
	loadPublicStats,
} from "../../../../src/lib/cache/public-stats-read";
import { shanghaiTodayStartUnix } from "../../../../src/lib/shanghaiTime";
import { readingFixture } from "./thread-cache-fixture";

describe("public-stats-read cache loader", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-30T10:00:00Z")); // 18:00 Shanghai
		__resetMetricsForTest();
		f = readingFixture();
		f.thread(1);
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("countPostsInDay counts posts within the 86400s Shanghai window using indexed bounds", async () => {
		const todayStart = shanghaiTodayStartUnix();
		// Post yesterday
		f.post(101, { created_at: todayStart - 10 });
		// Posts today
		f.post(102, { created_at: todayStart });
		f.post(103, { created_at: todayStart + 3600 });
		f.post(104, { created_at: todayStart + 86399 });
		// Post tomorrow
		f.post(105, { created_at: todayStart + 86400 });

		const count = await countPostsInDay(f.env, todayStart);
		expect(count).toBe(3);

		// Verify SQL arithmetic and indexed bounds
		const postCalls = f.calls.filter((c) => c.sql.includes("FROM posts WHERE created_at"));
		expect(postCalls.length).toBe(1);
		expect(postCalls[0].params).toEqual([todayStart, todayStart + 86400]);
	});

	it("loadPublicStats loads counters from settings, post count from D1, and online stats from KV", async () => {
		const todayStart = shanghaiTodayStartUnix();
		f.sqlite.prepare("UPDATE settings SET value = '15' WHERE key = 'stats.yesterday_posts'").run();
		f.sqlite.prepare("UPDATE settings SET value = '120' WHERE key = 'stats.total_threads'").run();
		f.sqlite.prepare("UPDATE settings SET value = '450' WHERE key = 'stats.total_posts'").run();
		f.sqlite.prepare("UPDATE settings SET value = '80' WHERE key = 'stats.total_members'").run();

		f.post(201, { created_at: todayStart + 100 });
		f.post(202, { created_at: todayStart + 200 });

		await f.env.KV.put("stats:online_count", "42");
		await f.env.KV.put("stats:online_peak", JSON.stringify({ count: 99, date: "2026-05-29" }));

		const stats = await loadPublicStats(f.env);

		expect(stats).toEqual({
			todayPosts: 2,
			yesterdayPosts: 15,
			totalThreads: 120,
			totalPosts: 450,
			totalMembers: 80,
			totalOnline: 42,
			peakOnline: 0,
			peakDate: "",
		});
	});

	it("getPublicStats caches result with SHORT tier and public-stats family", async () => {
		const todayStart = shanghaiTodayStartUnix();
		f.post(301, { created_at: todayStart + 100 });

		const res1 = await getPublicStats(f.env, f.ctx);
		expect(res1.todayPosts).toBe(1);

		// Next call should be served from KV cache
		f.post(302, { created_at: todayStart + 200 });
		const callsBefore = f.calls.length;

		const res2 = await getPublicStats(f.env, f.ctx);
		expect(res2.todayPosts).toBe(1); // Cached value
		expect(f.calls.length).toBe(callsBefore);

		// Advance time past SHORT tier (60s)
		vi.advanceTimersByTime(61_000);

		const res3 = await getPublicStats(f.env, f.ctx);
		expect(res3.todayPosts).toBe(2); // Fresh value
	});

	it("differentiates admin vs business source", async () => {
		const resAdmin = await getPublicStats(f.env, f.ctx, "admin");
		expect(resAdmin.todayPosts).toBe(0);
	});

	it("D1 failure throws error and does not return empty or corrupt cache", async () => {
		f.state.queryError = true;
		await expect(loadPublicStats(f.env)).rejects.toThrow("Statistics counters could not be read");
	});

	it("countPostsInDay rejects when row is missing or count is non-finite", async () => {
		const origPrepare = f.env.DB.prepare.bind(f.env.DB);
		vi.spyOn(f.env.DB, "prepare").mockImplementationOnce((sql: string) => {
			if (sql.includes("FROM posts WHERE created_at")) {
				return {
					bind: () => ({
						first: async () => null,
					}),
				} as unknown as D1PreparedStatement;
			}
			return origPrepare(sql);
		});
		await expect(countPostsInDay(f.env)).rejects.toThrow("Daily post count was not returned");

		vi.spyOn(f.env.DB, "prepare").mockImplementationOnce((sql: string) => {
			if (sql.includes("FROM posts WHERE created_at")) {
				return {
					bind: () => ({
						first: async () => ({ count: Number.NaN }),
					}),
				} as unknown as D1PreparedStatement;
			}
			return origPrepare(sql);
		});
		await expect(countPostsInDay(f.env)).rejects.toThrow("Daily post count was not returned");
	});

	it("loadPublicStats falls back to default 0 and empty string when runtime gauges are absent or corrupted shapes", async () => {
		// Non-numeric online count and peak object with missing/non-numeric properties
		await f.env.KV.put("stats:online_count", "not-a-number");
		await f.env.KV.put("stats:online_peak", JSON.stringify({ corrupted: true }));

		const stats = await loadPublicStats(f.env);
		expect(stats.totalOnline).toBe(0);
		expect(stats.peakOnline).toBe(0);
		expect(stats.peakDate).toBe("");
	});

	it("poisoned cache envelope misses, heals from authoritative origin, and repopulates valid envelope", async () => {
		const todayStart = shanghaiTodayStartUnix();
		f.post(401, { created_at: todayStart + 50 });

		// Put a poisoned envelope with missing fields or corrupt types into KV
		await f.env.KV.put(
			"public-stats",
			JSON.stringify({
				schemaVersion: 3,
				family: "public-stats",
				tier: "SHORT",
				loadedAt: Date.now(),
				expiresAt: Date.now() + 60_000,
				params: {},
				scope: "public",
				data: { corrupted: true, todayPosts: "not-a-number" },
			}),
		);

		// getPublicStats detects validator mismatch, falls back to loadPublicStats, and heals
		const healed = await getPublicStats(f.env, f.ctx);
		expect(healed.todayPosts).toBe(1);
		expect(healed.totalOnline).toBe(0);

		// KV is repopulated with a valid envelope
		const kvRaw = await f.env.KV.get("public-stats", "json");
		expect(isPublicStats((kvRaw as { data: unknown })?.data)).toBe(true);
	});

	it("isPublicStats validator rejects non-plain objects, missing keys, and non-finite numbers", () => {
		expect(isPublicStats(null)).toBe(false);
		expect(isPublicStats([])).toBe(false);
		expect(isPublicStats("string")).toBe(false);

		const valid = {
			todayPosts: 1,
			yesterdayPosts: 0,
			totalThreads: 10,
			totalPosts: 20,
			totalMembers: 5,
			totalOnline: 2,
			peakOnline: 10,
			peakDate: "2026-05-30",
		};
		expect(isPublicStats(valid)).toBe(true);

		// Non-finite number
		expect(isPublicStats({ ...valid, todayPosts: Number.NaN })).toBe(false);
		expect(isPublicStats({ ...valid, totalThreads: Number.POSITIVE_INFINITY })).toBe(false);

		// Missing peakDate or wrong type
		const { peakDate: _, ...withoutPeakDate } = valid;
		expect(isPublicStats(withoutPeakDate)).toBe(false);
		expect(isPublicStats({ ...valid, peakDate: 12345 })).toBe(false);

		// Extra dimension
		expect(isPublicStats({ ...valid, extra: "unexpected" })).toBe(false);
	});
});
