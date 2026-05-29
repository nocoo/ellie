// viewmodels/forum/stats.server.ts — Server-only data loader for public site stats
// Calls Worker API (GET /api/v1/stats).

import "server-only";

import { forumApi } from "@/lib/forum-api";

export interface SiteStats {
	todayPosts: number;
	yesterdayPosts: number;
	totalThreads: number;
	totalPosts: number;
	totalMembers: number;
	totalOnline: number;
	peakOnline: number;
	peakDate: string;
}

export async function loadSiteStats(): Promise<SiteStats> {
	const { data } = await forumApi.get<SiteStats>("/api/v1/stats");
	return data;
}
