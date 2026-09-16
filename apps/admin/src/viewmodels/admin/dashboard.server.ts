/**
 * Dashboard server-only API functions.
 * Only used from Server Components.
 */

import { adminApi } from "@/lib/admin-api";
import type {
	AnalyticsForumDist,
	AnalyticsTrend,
	TodayLoginsKpi,
	TodayVisitsKpi,
} from "./analytics";
import type { DashboardActivity, DashboardStats } from "./dashboard";

export async function fetchDashboardStats(): Promise<DashboardStats> {
	const res = await adminApi.get<DashboardStats>("/api/admin/stats");
	return res.data;
}

export async function fetchDashboardActivity(): Promise<DashboardActivity> {
	const [threads, posts, forums, visits, logins] = await Promise.allSettled([
		adminApi.get<AnalyticsTrend>("/api/admin/analytics/trend", { metric: "threads", range: "7d" }),
		adminApi.get<AnalyticsTrend>("/api/admin/analytics/trend", { metric: "posts", range: "7d" }),
		adminApi.get<AnalyticsForumDist>("/api/admin/analytics/forum-dist", { range: "7d" }),
		adminApi.get<TodayVisitsKpi>("/api/admin/analytics/today/visits"),
		adminApi.get<TodayLoginsKpi>("/api/admin/analytics/today/logins"),
	]);
	return {
		threads: threads.status === "fulfilled" ? threads.value.data : null,
		posts: posts.status === "fulfilled" ? posts.value.data : null,
		forums: forums.status === "fulfilled" ? forums.value.data : null,
		visits: visits.status === "fulfilled" ? visits.value.data : null,
		logins: logins.status === "fulfilled" ? logins.value.data : null,
	};
}
