import {
	ANALYTICS_RANGES,
	ANALYTICS_TREND_METRICS,
	METRIC_LABELS,
	RANGE_LABELS,
	parseCheckinTrend,
	parseForumDist,
	parseOverview,
	parseTrend,
} from "@/viewmodels/admin/analytics";
import { describe, expect, it } from "vitest";

describe("analytics viewmodel", () => {
	describe("constants", () => {
		it("exposes the supported ranges", () => {
			expect(ANALYTICS_RANGES).toEqual(["7d", "30d", "90d"]);
		});

		it("exposes the supported trend metrics", () => {
			expect(ANALYTICS_TREND_METRICS).toEqual(["users", "threads", "posts", "checkins"]);
		});

		it("has Chinese labels for every metric", () => {
			for (const m of ANALYTICS_TREND_METRICS) {
				expect(METRIC_LABELS[m]).toBeTruthy();
			}
		});

		it("has Chinese labels for every range", () => {
			for (const r of ANALYTICS_RANGES) {
				expect(RANGE_LABELS[r]).toBeTruthy();
			}
		});
	});

	describe("parseOverview", () => {
		it("parses a complete payload", () => {
			const raw = {
				now: 1_700_000_000,
				today: { newUsers: 5, newThreads: 7, newPosts: 23, checkins: 12 },
			};
			const result = parseOverview(raw);
			expect(result.now).toBe(1_700_000_000);
			expect(result.today.newUsers).toBe(5);
			expect(result.today.newThreads).toBe(7);
			expect(result.today.newPosts).toBe(23);
			expect(result.today.checkins).toBe(12);
		});

		it("defaults missing today fields to zero", () => {
			const result = parseOverview({ now: 1, today: { newUsers: 5 } });
			expect(result.today.newUsers).toBe(5);
			expect(result.today.newThreads).toBe(0);
			expect(result.today.newPosts).toBe(0);
			expect(result.today.checkins).toBe(0);
		});

		it("handles null input", () => {
			const result = parseOverview(null);
			expect(result.now).toBe(0);
			expect(result.today.newUsers).toBe(0);
			expect(result.today.checkins).toBe(0);
		});

		it("handles undefined input", () => {
			const result = parseOverview(undefined);
			expect(result.now).toBe(0);
			expect(result.today.newPosts).toBe(0);
		});

		it("coerces non-finite/string values to zero", () => {
			const result = parseOverview({
				now: Number.NaN,
				today: {
					newUsers: "5" as unknown as number,
					newThreads: Number.POSITIVE_INFINITY,
					newPosts: null as unknown as number,
					checkins: undefined as unknown as number,
				},
			});
			expect(result.now).toBe(0);
			expect(result.today.newUsers).toBe(0);
			// Infinity is not finite per Number.isFinite -> fallback 0
			expect(result.today.newThreads).toBe(0);
			expect(result.today.newPosts).toBe(0);
			expect(result.today.checkins).toBe(0);
		});
	});

	describe("parseTrend", () => {
		it("parses a complete payload and preserves point order", () => {
			const raw = {
				metric: "threads",
				range: "30d",
				series: [
					{ date: "2026-05-01", count: 3 },
					{ date: "2026-05-02", count: 7 },
				],
			};
			const result = parseTrend(raw, "users", "7d");
			expect(result.metric).toBe("threads");
			expect(result.range).toBe("30d");
			expect(result.series).toEqual([
				{ date: "2026-05-01", count: 3 },
				{ date: "2026-05-02", count: 7 },
			]);
		});

		it("falls back to caller defaults when metric/range are unknown", () => {
			const result = parseTrend({ metric: "bogus", range: "999d", series: [] }, "posts", "90d");
			expect(result.metric).toBe("posts");
			expect(result.range).toBe("90d");
		});

		it("returns empty series when series is missing or not an array", () => {
			expect(parseTrend({ metric: "users", range: "7d" }, "users", "7d").series).toEqual([]);
			expect(
				parseTrend({ metric: "users", range: "7d", series: "nope" }, "users", "7d").series,
			).toEqual([]);
		});

		it("defaults missing series point fields to safe zero/empty string", () => {
			const raw = {
				metric: "users",
				range: "7d",
				series: [{}, { date: "2026-05-03" }, { count: 9 }],
			};
			const result = parseTrend(raw, "users", "7d");
			expect(result.series).toEqual([
				{ date: "", count: 0 },
				{ date: "2026-05-03", count: 0 },
				{ date: "", count: 9 },
			]);
		});

		it("handles null and undefined input", () => {
			const a = parseTrend(null, "users", "7d");
			expect(a.metric).toBe("users");
			expect(a.range).toBe("7d");
			expect(a.series).toEqual([]);

			const b = parseTrend(undefined, "checkins", "90d");
			expect(b.metric).toBe("checkins");
			expect(b.range).toBe("90d");
		});
	});

	describe("parseForumDist", () => {
		it("parses a complete payload", () => {
			const raw = {
				range: "30d",
				rows: [
					{ forumId: 1, forumName: "灌水", posts: 42 },
					{ forumId: 2, forumName: "技术", posts: 17 },
				],
			};
			const result = parseForumDist(raw, "7d");
			expect(result.range).toBe("30d");
			expect(result.rows).toHaveLength(2);
			expect(result.rows[0]).toEqual({ forumId: 1, forumName: "灌水", posts: 42 });
		});

		it("falls back to caller range when unknown", () => {
			const result = parseForumDist({ range: "bogus", rows: [] }, "30d");
			expect(result.range).toBe("30d");
		});

		it("returns empty rows when missing or not an array", () => {
			expect(parseForumDist({ range: "7d" }, "7d").rows).toEqual([]);
			expect(parseForumDist({ range: "7d", rows: "nope" }, "7d").rows).toEqual([]);
		});

		it("defaults missing row fields", () => {
			const raw = { range: "7d", rows: [{}, { forumName: "X" }, { forumId: 3, posts: 5 }] };
			const result = parseForumDist(raw, "7d");
			expect(result.rows).toEqual([
				{ forumId: 0, forumName: "", posts: 0 },
				{ forumId: 0, forumName: "X", posts: 0 },
				{ forumId: 3, forumName: "", posts: 5 },
			]);
		});

		it("handles null and undefined input", () => {
			expect(parseForumDist(null, "7d")).toEqual({ range: "7d", rows: [] });
			expect(parseForumDist(undefined, "90d")).toEqual({ range: "90d", rows: [] });
		});
	});

	describe("parseCheckinTrend", () => {
		it("parses a complete payload", () => {
			const raw = {
				range: "7d",
				series: [
					{ date: "2026-05-01", count: 10 },
					{ date: "2026-05-02", count: 15 },
				],
			};
			const result = parseCheckinTrend(raw, "30d");
			expect(result.range).toBe("7d");
			expect(result.series).toEqual([
				{ date: "2026-05-01", count: 10 },
				{ date: "2026-05-02", count: 15 },
			]);
		});

		it("falls back to caller range when unknown", () => {
			const result = parseCheckinTrend({ range: "bogus" }, "90d");
			expect(result.range).toBe("90d");
		});

		it("returns empty series when missing or not an array", () => {
			expect(parseCheckinTrend({ range: "7d" }, "7d").series).toEqual([]);
			expect(parseCheckinTrend({ range: "7d", series: 42 }, "7d").series).toEqual([]);
		});

		it("handles null and undefined input", () => {
			expect(parseCheckinTrend(null, "7d")).toEqual({ range: "7d", series: [] });
			expect(parseCheckinTrend(undefined, "30d")).toEqual({ range: "30d", series: [] });
		});
	});
});
