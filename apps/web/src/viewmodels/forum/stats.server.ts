// viewmodels/forum/stats.server.ts — Server-only data loader for public site stats
// Doc/29: numeric snapshot cached in the process memory runtime (5 min,
// Shanghai-midnight TTL) — a warm hit performs no Worker call.

import "server-only";

import { forumApi } from "@/lib/forum-api";
import { getMemoryRuntime } from "@/lib/memory-runtime";

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

async function fetchSiteStats(): Promise<SiteStats> {
	const { data } = await forumApi.get<SiteStats>("/api/v1/stats");
	return data;
}

export async function loadSiteStats(): Promise<SiteStats> {
	return getMemoryRuntime().read("site-stats", "site:v1", fetchSiteStats);
}
