// Public stats handler — GET /api/v1/stats
// Returns site-wide statistics for the forum header/footer.
// Cached in KV for 600 seconds. Reads pre-computed counters from settings table
// and KV instead of running expensive COUNT(*) queries.

import {
	recordError,
	recordHit,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
} from "../lib/cache/metrics";
import type { CFRequest, Env } from "../lib/env";
import { jsonResponse } from "../lib/response";

const CACHE_KEY = "public-stats";
const CACHE_TTL_SECONDS = 600;
const METRICS_FAMILY = "public-stats";

export interface PublicStats {
	todayPosts: number;
	yesterdayPosts: number;
	totalThreads: number;
	totalPosts: number;
	totalMembers: number;
	totalOnline: number;
	peakOnline: number;
	peakDate: string;
}

// Settings keys for pre-computed counters
const STATS_SETTINGS_KEYS = [
	"stats.total_threads",
	"stats.total_posts",
	"stats.total_members",
	"stats.yesterday_posts",
] as const;

/** GET /api/v1/stats — public site statistics */
export async function stats(
	request: CFRequest,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Try KV cache first
	let cached: string | null = null;
	recordRead(METRICS_FAMILY);
	try {
		cached = await env.KV.get(CACHE_KEY);
	} catch (err) {
		recordError(METRICS_FAMILY);
		console.warn("[stats] KV read failed", err);
	}
	if (cached) {
		recordHit(METRICS_FAMILY);
		if (ctx) scheduleMetricsFlush(env, ctx);
		return jsonResponse(JSON.parse(cached) as PublicStats, origin);
	}
	recordMiss(METRICS_FAMILY);

	// Parallel fetch: settings from D1 + KV counters
	const [settingsResult, todayPostsStr, onlineCount, peakData] = await Promise.all([
		// Read pre-computed counters from settings table
		env.DB.prepare(
			`SELECT key, value FROM settings WHERE key IN (${STATS_SETTINGS_KEYS.map(() => "?").join(", ")})`,
		)
			.bind(...STATS_SETTINGS_KEYS)
			.all<{ key: string; value: string }>(),
		// Today's posts counter from KV (incremented on each post)
		env.KV.get("stats:today_posts"),
		// Current online count (aggregated by cron)
		env.KV.get("stats:online_count"),
		// Historical peak (no TTL)
		env.KV.get("stats:online_peak", "json") as Promise<{
			count: number;
			date: string;
		} | null>,
	]);

	// Parse settings into a map
	const settingsMap = new Map<string, number>();
	for (const row of settingsResult.results) {
		settingsMap.set(row.key, Number.parseInt(row.value, 10) || 0);
	}

	const data: PublicStats = {
		todayPosts: todayPostsStr ? Number.parseInt(todayPostsStr, 10) : 0,
		yesterdayPosts: settingsMap.get("stats.yesterday_posts") ?? 0,
		totalThreads: settingsMap.get("stats.total_threads") ?? 0,
		totalPosts: settingsMap.get("stats.total_posts") ?? 0,
		totalMembers: settingsMap.get("stats.total_members") ?? 0,
		// Online stats from KV (populated by cron aggregation)
		totalOnline: onlineCount ? Number.parseInt(onlineCount, 10) : 0,
		peakOnline: peakData?.count ?? 0,
		peakDate: peakData?.date ?? "",
	};

	// Write to KV cache (fire-and-forget)
	try {
		await env.KV.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });
		recordWrite(METRICS_FAMILY);
	} catch (err) {
		recordError(METRICS_FAMILY);
		console.warn("[stats] KV write-back failed", err);
	}

	if (ctx) scheduleMetricsFlush(env, ctx);
	return jsonResponse(data, origin);
}
