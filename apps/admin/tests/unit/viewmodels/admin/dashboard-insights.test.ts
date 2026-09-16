import { describe, expect, it } from "vitest";
import { metricShare, summarizeTrend } from "@/viewmodels/admin/analytics";
import { contentTrendRows } from "@/viewmodels/admin/dashboard";

describe("dashboard insights", () => {
	it("aligns series by date without inventing zeroes for missing observations", () => {
		expect(
			contentTrendRows({
				threads: {
					metric: "threads",
					range: "7d",
					series: [
						{ date: "2026-09-15", count: 0 },
						{ date: "2026-09-14", count: 4 },
					],
				},
				posts: { metric: "posts", range: "7d", series: [{ date: "2026-09-15", count: 12 }] },
			}),
		).toEqual([
			{ x: "2026-09-14", threads: 4, posts: null },
			{ x: "2026-09-15", threads: 0, posts: 12 },
		]);
		expect(contentTrendRows({ threads: null, posts: null })).toEqual([]);
	});
	it("distinguishes a zero share from an unavailable denominator", () => {
		expect(metricShare(0, 5)).toBe("0%");
		expect(metricShare(1, 3)).toBe("33.3%");
		expect(metricShare(0, 0)).toBe("—");
		expect(metricShare(1, Number.NaN)).toBe("—");
	});
	it("summarizes the returned period including zero-activity days", () => {
		expect(
			summarizeTrend([
				{ date: "2026-09-14", count: 0 },
				{ date: "2026-09-15", count: 6 },
			]),
		).toEqual({ total: 6, average: 3, peak: { date: "2026-09-15", count: 6 }, activeDays: 1 });
		expect(summarizeTrend([])).toEqual({ total: 0, average: null, peak: null, activeDays: 0 });
	});
});
