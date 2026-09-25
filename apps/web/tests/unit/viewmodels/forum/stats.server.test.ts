import { EMPTY_HOME_STATS } from "@ellie/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSiteStats } from "@/viewmodels/forum/stats.server";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/daily-statistics", () => ({ getDailyStatistics: () => ({ read }) }));

describe("loadSiteStats", () => {
	const stats = {
		todayPosts: 10,
		yesterdayPosts: 20,
		totalThreads: 1000,
		totalPosts: 5000,
		totalMembers: 200,
		totalOnline: 50,
		peakOnline: 100,
		peakDate: "2025-01-01",
	};

	beforeEach(() => read.mockReset());

	it("returns the current daily memory snapshot", async () => {
		read.mockResolvedValue({ stats });
		expect(await loadSiteStats()).toEqual(stats);
		expect(read).toHaveBeenCalledExactlyOnceWith();
	});

	it("uses a fresh empty object when no snapshot is available and recovers on the next read", async () => {
		read.mockResolvedValueOnce(null).mockResolvedValueOnce({ stats });
		const empty = await loadSiteStats();
		expect(empty).toEqual(EMPTY_HOME_STATS);
		expect(empty).not.toBe(EMPTY_HOME_STATS);
		empty.totalThreads = 100;
		expect(EMPTY_HOME_STATS.totalThreads).toBe(0);
		expect(await loadSiteStats()).toEqual(stats);
	});
});
