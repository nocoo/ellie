import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shanghaiDateLocal, shanghaiTodayStartUnix } from "../../../src/lib/shanghaiTime";
import { checkAndRolloverDailyStats } from "../../../src/lib/stats-rollover";
import { readingFixture } from "./cache/thread-cache-fixture";

describe("stats-rollover", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		f = readingFixture();
		f.thread(1);
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("checkAndRolloverDailyStats", () => {
		it("initializes date marker and sets yesterday_posts from committed records on first run", async () => {
			// Set time to 2026-05-30 10:00 Beijing (02:00 UTC)
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));
			const todayStart = shanghaiTodayStartUnix();

			// Insert posts from yesterday (2026-05-29)
			f.post(10, { created_at: todayStart - 3600 });
			f.post(11, { created_at: todayStart - 7200 });

			await checkAndRolloverDailyStats(f.env);

			// Date marker should be set in KV to current Shanghai date
			expect(await f.env.KV.get("stats:today_date")).toBe("2026-05-30");

			// settings.stats.yesterday_posts should be updated to 2 from committed records
			const yesterday = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.yesterday_posts'")
				.get() as { value: string };
			expect(yesterday.value).toBe("2");
		});

		it("does nothing when date marker matches current Shanghai date", async () => {
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));
			await f.env.KV.put("stats:today_date", "2026-05-30");

			const callsBefore = f.calls.length;
			await checkAndRolloverDailyStats(f.env);

			// No D1 writes should occur
			const updateCalls = f.calls.slice(callsBefore).filter((c) => c.sql.startsWith("UPDATE"));
			expect(updateCalls).toHaveLength(0);
		});

		it("derives yesterday from committed posts on changed date marker and invalidates public-stats cache", async () => {
			// Start on 2026-05-30
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));
			await f.env.KV.put("stats:today_date", "2026-05-30");

			// Insert 3 posts on 2026-05-30
			const may30Start = shanghaiTodayStartUnix();
			f.post(20, { created_at: may30Start + 1000 });
			f.post(21, { created_at: may30Start + 2000 });
			f.post(22, { created_at: may30Start + 3000 });

			// Populate public-stats in KV
			await f.env.KV.put("public-stats", JSON.stringify({ cached: true }));

			// Advance time to 2026-05-31 00:05 Beijing (16:05 UTC May 30)
			vi.setSystemTime(new Date("2026-05-30T16:05:00Z"));
			expect(shanghaiDateLocal()).toBe("2026-05-31");

			await checkAndRolloverDailyStats(f.env);

			// Date marker updated
			expect(await f.env.KV.get("stats:today_date")).toBe("2026-05-31");

			// Yesterday's count updated in D1 settings to 3
			const yesterday = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.yesterday_posts'")
				.get() as { value: string };
			expect(yesterday.value).toBe("3");

			// ONLY public-stats cache invalidated
			expect(await f.env.KV.get("public-stats")).toBeNull();
		});

		it("handles zero posts yesterday accurately", async () => {
			await f.env.KV.put("stats:today_date", "2026-05-29");
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			await checkAndRolloverDailyStats(f.env);

			const yesterday = f.sqlite
				.prepare("SELECT value FROM settings WHERE key = 'stats.yesterday_posts'")
				.get() as { value: string };
			expect(yesterday.value).toBe("0");
		});

		it("D1 failure does not mutate date marker", async () => {
			await f.env.KV.put("stats:today_date", "2026-05-29");
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			// Simulate D1 failure on UPDATE
			vi.spyOn(f.env.DB, "prepare").mockImplementationOnce(() => {
				throw new Error("D1 unavailable");
			});

			await expect(checkAndRolloverDailyStats(f.env)).rejects.toThrow("D1 unavailable");

			// Marker must NOT have been updated to 2026-05-30
			expect(await f.env.KV.get("stats:today_date")).toBe("2026-05-29");
		});

		it("D1 unconfirmed update failure throws and does not mutate marker", async () => {
			await f.env.KV.put("stats:today_date", "2026-05-29");
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			const origPrepare = f.env.DB.prepare.bind(f.env.DB);
			vi.spyOn(f.env.DB, "prepare").mockImplementation((sql: string) => {
				const stmt = origPrepare(sql);
				if (sql.startsWith("UPDATE settings")) {
					return {
						bind: (..._params: unknown[]) => ({
							run: async () => ({
								success: false,
								results: [],
								meta: { changes: 0, last_row_id: 0 },
							}),
						}),
					} as unknown as D1PreparedStatement;
				}
				return stmt;
			});

			await expect(checkAndRolloverDailyStats(f.env)).rejects.toThrow(
				"Daily statistics update was not confirmed",
			);
			expect(await f.env.KV.get("stats:today_date")).toBe("2026-05-29");
		});
	});
});
