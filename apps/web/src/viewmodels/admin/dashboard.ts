// viewmodels/admin/dashboard.ts — Dashboard ViewModel
// Ref: 04c §仪表盘 — stats aggregation, trend data, recent items

import type { Repositories } from "@ellie/repositories";
import type { Thread, User } from "@ellie/types";

export interface DashboardStats {
	totalUsers: number;
	totalPosts: number;
	todayThreads: number;
	todayActiveUsers: number;
}

export interface TrendPoint {
	date: string; // YYYY-MM-DD
	count: number;
}

export interface DashboardData {
	stats: DashboardStats;
	trendData: TrendPoint[];
	recentUsers: User[];
	recentThreads: Thread[];
}

/** Start of today in epoch seconds */
export function todayStart(): number {
	const now = new Date();
	now.setHours(0, 0, 0, 0);
	return Math.floor(now.getTime() / 1000);
}

/** Start of N days ago in epoch seconds */
export function daysAgo(n: number): number {
	const d = new Date();
	d.setDate(d.getDate() - n);
	d.setHours(0, 0, 0, 0);
	return Math.floor(d.getTime() / 1000);
}

/** Aggregate threads by creation date into daily counts */
export function aggregateTrend(threads: Thread[], days: number): TrendPoint[] {
	const result: TrendPoint[] = [];
	const now = new Date();

	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const dateStr = d.toISOString().slice(0, 10);
		const dayStart = new Date(d);
		dayStart.setHours(0, 0, 0, 0);
		const dayEnd = new Date(d);
		dayEnd.setHours(23, 59, 59, 999);
		const startEpoch = Math.floor(dayStart.getTime() / 1000);
		const endEpoch = Math.floor(dayEnd.getTime() / 1000);

		const count = threads.filter(
			(t) => t.createdAt >= startEpoch && t.createdAt <= endEpoch,
		).length;
		result.push({ date: dateStr, count });
	}

	return result;
}

/** Fetch all dashboard data from repositories */
export async function fetchDashboardData(repos: Repositories): Promise<DashboardData> {
	const today = todayStart();
	const weekAgo = daysAgo(7);

	const [
		allUsers,
		allThreads,
		todayThreadResult,
		todayActiveResult,
		recentUsersResult,
		recentThreadsResult,
	] = await Promise.all([
		repos.users.list({ limit: 1 }),
		repos.threads.list({ createdAfter: weekAgo, limit: 250 }),
		repos.threads.list({ createdAfter: today, limit: 1 }),
		repos.users.list({ lastLoginAfter: today, limit: 1 }),
		repos.users.list({ sort: "newest", limit: 5 }),
		repos.threads.list({ sort: "newest", limit: 5 }),
	]);

	// Total posts = sum of all thread replies + thread count (each thread has a first post)
	const totalPosts = allThreads.items.reduce((sum, t) => sum + t.replies + 1, 0);

	const stats: DashboardStats = {
		totalUsers: allUsers.total,
		totalPosts,
		todayThreads: todayThreadResult.total,
		todayActiveUsers: todayActiveResult.total,
	};

	const trendData = aggregateTrend(allThreads.items, 7);

	return {
		stats,
		trendData,
		recentUsers: recentUsersResult.items,
		recentThreads: recentThreadsResult.items,
	};
}
