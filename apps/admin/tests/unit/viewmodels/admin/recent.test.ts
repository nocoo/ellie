import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		getList: vi.fn(),
	},
}));

import { apiClient } from "@/lib/api-client";
import {
	TAB_LABELS,
	TIME_RANGE_LABELS,
	fetchRecentAttachments,
	fetchRecentPosts,
	fetchRecentThreads,
	fetchRecentUsers,
	timeRangeToBounds,
} from "@/viewmodels/admin/recent";

const mockGetList = apiClient.getList as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("recent viewmodel", () => {
	describe("TAB_LABELS", () => {
		it("contains all four tabs", () => {
			expect(Object.keys(TAB_LABELS)).toEqual(["users", "threads", "posts", "attachments"]);
		});
	});

	describe("TIME_RANGE_LABELS", () => {
		it("contains all four ranges", () => {
			expect(Object.keys(TIME_RANGE_LABELS)).toEqual(["today", "7d", "30d", "custom"]);
		});
	});

	describe("timeRangeToBounds", () => {
		it("returns min < max for today", () => {
			const { min, max } = timeRangeToBounds("today");
			expect(min).toBeLessThan(max);
			expect(max).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
		});

		it("returns broader range for 7d than today", () => {
			const today = timeRangeToBounds("today");
			const week = timeRangeToBounds("7d");
			expect(week.min).toBeLessThan(today.min);
			expect(week.max).toBe(today.max);
		});

		it("returns broader range for 30d than 7d", () => {
			const week = timeRangeToBounds("7d");
			const month = timeRangeToBounds("30d");
			expect(month.min).toBeLessThan(week.min);
		});

		it("uses customStart and customEnd for custom range", () => {
			const { min, max } = timeRangeToBounds("custom", 1000, 2000);
			expect(min).toBe(1000);
			expect(max).toBe(2000);
		});

		it("defaults custom min to 0 if not provided", () => {
			const { min } = timeRangeToBounds("custom");
			expect(min).toBe(0);
		});

		it("defaults custom max to now if not provided", () => {
			const { max } = timeRangeToBounds("custom", 1000);
			const nowSecs = Math.floor(Date.now() / 1000);
			expect(max).toBeGreaterThanOrEqual(nowSecs - 2);
			expect(max).toBeLessThanOrEqual(nowSecs + 2);
		});

		it("today min is aligned to midnight Shanghai time", () => {
			const { min } = timeRangeToBounds("today");
			const date = new Date(min * 1000);
			const parts = new Intl.DateTimeFormat("en-US", {
				timeZone: "Asia/Shanghai",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				hour12: false,
			}).formatToParts(date);
			const hour = parts.find((p) => p.type === "hour")?.value;
			const minute = parts.find((p) => p.type === "minute")?.value;
			const second = parts.find((p) => p.type === "second")?.value;
			expect(hour).toBe("00");
			expect(minute).toBe("00");
			expect(second).toBe("00");
		});
	});

	describe("fetch functions", () => {
		const meta = { total: 5, page: 1, pages: 1, limit: 20 };

		it("fetchRecentUsers calls getList with regDateMin/Max", async () => {
			mockGetList.mockResolvedValue({ data: [], meta });
			await fetchRecentUsers(1000, 2000, 1, 20);
			expect(mockGetList).toHaveBeenCalledWith("/api/admin/users", {
				regDateMin: 1000,
				regDateMax: 2000,
				page: 1,
				limit: 20,
			});
		});

		it("fetchRecentThreads calls getList with createdAtMin/Max", async () => {
			mockGetList.mockResolvedValue({ data: [], meta });
			await fetchRecentThreads(1000, 2000, 2, 10);
			expect(mockGetList).toHaveBeenCalledWith("/api/admin/threads", {
				createdAtMin: 1000,
				createdAtMax: 2000,
				page: 2,
				limit: 10,
			});
		});

		it("fetchRecentPosts calls getList with createdAtMin/Max", async () => {
			mockGetList.mockResolvedValue({ data: [], meta });
			await fetchRecentPosts(500, 900);
			expect(mockGetList).toHaveBeenCalledWith("/api/admin/posts", {
				createdAtMin: 500,
				createdAtMax: 900,
				page: 1,
				limit: 20,
			});
		});

		it("fetchRecentAttachments calls getList with createdAtMin/Max", async () => {
			mockGetList.mockResolvedValue({ data: [], meta });
			await fetchRecentAttachments(100, 200, 3, 50);
			expect(mockGetList).toHaveBeenCalledWith("/api/admin/attachments", {
				createdAtMin: 100,
				createdAtMax: 200,
				page: 3,
				limit: 50,
			});
		});
	});
});
