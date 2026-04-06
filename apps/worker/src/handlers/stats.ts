// Public stats handler — GET /api/v1/stats
// Returns site-wide statistics for the forum header/footer.
// Cached in KV for 60 seconds to avoid repeated COUNT queries.
// Only counts visible content (posts.invisible = 0, threads.sticky >= 0, users.status >= 0)

import type { CFRequest, Env } from "../lib/env";
import { jsonResponse } from "../lib/response";

const CACHE_KEY = "public-stats";
const CACHE_TTL_SECONDS = 60;

export interface PublicStats {
	todayPosts: number;
	yesterdayPosts: number;
	totalThreads: number;
	totalMembers: number;
	newestMember: string;
	totalOnline: number;
	peakOnline: number;
	peakDate: string;
}

/** Compute the UTC start-of-day timestamp for today and yesterday. */
function dayBoundaries(): { todayStart: number; yesterdayStart: number; yesterdayEnd: number } {
	const nowSec = Math.floor(Date.now() / 1000);
	const todayStart = nowSec - (nowSec % 86400);
	const yesterdayStart = todayStart - 86400;
	return { todayStart, yesterdayStart, yesterdayEnd: todayStart };
}

/** GET /api/v1/stats — public site statistics */
export async function stats(request: CFRequest, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Try KV cache first
	const cached = await env.KV.get(CACHE_KEY);
	if (cached) {
		return jsonResponse(JSON.parse(cached) as PublicStats, origin);
	}

	const { todayStart, yesterdayStart, yesterdayEnd } = dayBoundaries();

	// Parallel fetch: D1 batch + KV online stats
	// Only count visible content:
	// - posts.invisible = 0 (visible posts only)
	// - threads.sticky >= 0 (visible threads only)
	// - users.status >= 0 (normal users only, excludes banned/placeholder)
	const [dbResults, onlineCount, peakData] = await Promise.all([
		env.DB.batch([
			// 0: today's visible posts
			env.DB.prepare(
				"SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ? AND invisible = 0",
			).bind(todayStart),
			// 1: yesterday's visible posts
			env.DB.prepare(
				"SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ? AND created_at < ? AND invisible = 0",
			).bind(yesterdayStart, yesterdayEnd),
			// 2: total visible threads
			env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads WHERE sticky >= 0"),
			// 3: total normal members (excludes banned/placeholder/archived users)
			env.DB.prepare("SELECT COUNT(*) AS cnt FROM users WHERE status >= 0"),
			// 4: newest normal member (excludes banned/placeholder users)
			env.DB.prepare(
				"SELECT username FROM users WHERE status >= 0 ORDER BY reg_date DESC LIMIT 1",
			),
		]),
		// Current online count (aggregated by cron)
		env.KV.get("stats:online_count"),
		// Historical peak (no TTL)
		env.KV.get("stats:online_peak", "json") as Promise<{
			count: number;
			date: string;
		} | null>,
	]);

	const count = (i: number) => (dbResults[i].results[0] as Record<string, number>).cnt;
	const newestRow = dbResults[4].results[0] as Record<string, string> | undefined;

	const data: PublicStats = {
		todayPosts: count(0),
		yesterdayPosts: count(1),
		totalThreads: count(2),
		totalMembers: count(3),
		newestMember: newestRow?.username ?? "",
		// Online stats from KV (populated by cron aggregation)
		totalOnline: onlineCount ? Number.parseInt(onlineCount, 10) : 0,
		peakOnline: peakData?.count ?? 0,
		peakDate: peakData?.date ?? "",
	};

	// Write to KV cache (fire-and-forget)
	await env.KV.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });

	return jsonResponse(data, origin);
}
