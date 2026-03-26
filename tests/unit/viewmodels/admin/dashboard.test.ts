import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import {
	aggregateTrend,
	daysAgo,
	fetchDashboardData,
	todayStart,
} from "@/viewmodels/admin/dashboard";

describe("dashboard ViewModel", () => {
	// ─── Pure functions ──────────────────────────────────
	describe("todayStart", () => {
		test("returns a number (epoch seconds)", () => {
			const ts = todayStart();
			expect(typeof ts).toBe("number");
			expect(ts).toBeGreaterThan(0);
		});

		test("is at midnight (no hours/mins/secs)", () => {
			const ts = todayStart();
			const d = new Date(ts * 1000);
			expect(d.getHours()).toBe(0);
			expect(d.getMinutes()).toBe(0);
			expect(d.getSeconds()).toBe(0);
		});
	});

	describe("daysAgo", () => {
		test("daysAgo(0) is same as todayStart", () => {
			expect(daysAgo(0)).toBe(todayStart());
		});

		test("daysAgo(1) is 86400 seconds before todayStart", () => {
			const diff = todayStart() - daysAgo(1);
			expect(diff).toBe(86400);
		});

		test("daysAgo(7) is 7 * 86400 before todayStart", () => {
			const diff = todayStart() - daysAgo(7);
			expect(diff).toBe(7 * 86400);
		});
	});

	describe("aggregateTrend", () => {
		test("returns N points for N days", () => {
			const result = aggregateTrend([], 7);
			expect(result).toHaveLength(7);
		});

		test("all points have date and count", () => {
			const result = aggregateTrend([], 3);
			for (const p of result) {
				expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(typeof p.count).toBe("number");
			}
		});

		test("counts threads on matching days", () => {
			const now = Math.floor(Date.now() / 1000);
			const threads = [
				{ createdAt: now, id: 1 },
				{ createdAt: now - 100, id: 2 },
			] as Parameters<typeof aggregateTrend>[0];

			const result = aggregateTrend(threads, 1);
			expect(result).toHaveLength(1);
			expect(result[0].count).toBe(2);
		});

		test("empty threads → all zero counts", () => {
			const result = aggregateTrend([], 7);
			for (const p of result) {
				expect(p.count).toBe(0);
			}
		});

		test("dates are in chronological order", () => {
			const result = aggregateTrend([], 5);
			for (let i = 1; i < result.length; i++) {
				expect(result[i].date > result[i - 1].date).toBe(true);
			}
		});
	});

	// ─── Integration with repos ──────────────────────────
	describe("fetchDashboardData", () => {
		test("returns complete dashboard data structure", async () => {
			const repos = createRepositories();
			const data = await fetchDashboardData(repos);

			expect(data.stats).toBeDefined();
			expect(typeof data.stats.totalUsers).toBe("number");
			expect(typeof data.stats.totalPosts).toBe("number");
			expect(typeof data.stats.todayThreads).toBe("number");
			expect(typeof data.stats.todayActiveUsers).toBe("number");

			expect(Array.isArray(data.trendData)).toBe(true);
			expect(data.trendData).toHaveLength(7);

			expect(Array.isArray(data.recentUsers)).toBe(true);
			expect(data.recentUsers.length).toBeLessThanOrEqual(5);

			expect(Array.isArray(data.recentThreads)).toBe(true);
			expect(data.recentThreads.length).toBeLessThanOrEqual(5);
		});

		test("totalUsers matches repo data", async () => {
			const repos = createRepositories();
			const data = await fetchDashboardData(repos);
			const allUsers = await repos.users.list({});
			expect(data.stats.totalUsers).toBe(allUsers.total);
		});

		test("recentUsers are sorted newest first", async () => {
			const repos = createRepositories();
			const data = await fetchDashboardData(repos);
			if (data.recentUsers.length > 1) {
				for (let i = 1; i < data.recentUsers.length; i++) {
					expect(data.recentUsers[i - 1].regDate).toBeGreaterThanOrEqual(
						data.recentUsers[i].regDate,
					);
				}
			}
		});

		test("recentThreads are sorted newest first", async () => {
			const repos = createRepositories();
			const data = await fetchDashboardData(repos);
			if (data.recentThreads.length > 1) {
				for (let i = 1; i < data.recentThreads.length; i++) {
					expect(data.recentThreads[i - 1].createdAt).toBeGreaterThanOrEqual(
						data.recentThreads[i].createdAt,
					);
				}
			}
		});
	});
});
