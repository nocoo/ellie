// Public stats handler — GET /api/v1/stats
// Returns site-wide statistics for the forum header/footer.
// Cached in KV for 60 seconds to avoid repeated COUNT queries.

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

	const results = await env.DB.batch([
		// 0: today's posts
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ?").bind(todayStart),
		// 1: yesterday's posts
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM posts WHERE created_at >= ? AND created_at < ?").bind(
			yesterdayStart,
			yesterdayEnd,
		),
		// 2: total threads
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM threads"),
		// 3: total members
		env.DB.prepare("SELECT COUNT(*) AS cnt FROM users"),
		// 4: newest member
		env.DB.prepare("SELECT username FROM users ORDER BY reg_date DESC LIMIT 1"),
	]);

	const count = (i: number) => (results[i].results[0] as Record<string, number>).cnt;
	const newestRow = results[4].results[0] as Record<string, string> | undefined;

	const data: PublicStats = {
		todayPosts: count(0),
		yesterdayPosts: count(1),
		totalThreads: count(2),
		totalMembers: count(3),
		newestMember: newestRow?.username ?? "",
		// Online stats — placeholder until tracking mechanism is built
		totalOnline: 0,
		peakOnline: 0,
		peakDate: "",
	};

	// Write to KV cache (fire-and-forget)
	await env.KV.put(CACHE_KEY, JSON.stringify(data), { expirationTtl: CACHE_TTL_SECONDS });

	return jsonResponse(data, origin);
}
