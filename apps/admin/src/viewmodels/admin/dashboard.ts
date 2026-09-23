/**
 * Dashboard types and pure helpers.
 * Client-safe — no server-only imports.
 */

import type { AnalyticsForumDist, AnalyticsTrend, TodayLoginsKpi } from "./analytics";

export interface DashboardActivity {
	threads: AnalyticsTrend | null;
	posts: AnalyticsTrend | null;
	forums: AnalyticsForumDist | null;
	logins: TodayLoginsKpi | null;
}

export function contentTrendRows(activity: Pick<DashboardActivity, "threads" | "posts">) {
	const threads = new Map(activity.threads?.series.map((point) => [point.date, point.count]));
	const posts = new Map(activity.posts?.series.map((point) => [point.date, point.count]));
	return [...new Set([...threads.keys(), ...posts.keys()])].sort().map((date) => ({
		x: date,
		threads: threads.get(date) ?? null,
		posts: posts.get(date) ?? null,
	}));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStats {
	users: { total: number | null };
	threads: { total: number | null };
	posts: { total: number | null };
	source: "stored-counters";
	observedAt: number;
}
