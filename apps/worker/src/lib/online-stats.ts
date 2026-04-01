// Online statistics aggregation — runs via scheduled cron
import type { Env } from "./env";

/**
 * Aggregate online user count from KV and update peak if needed.
 * Called by scheduled cron handler every 5 minutes.
 *
 * Logic:
 * - List all `online:*` keys (each represents an active user with TTL)
 * - Store current count in `stats:online_count` (5 min TTL)
 * - Update `stats:online_peak` if current count exceeds previous peak (no TTL)
 */
export async function aggregateOnlineStats(env: Env): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	let totalCount = 0;
	let cursor: string | undefined;

	// Paginate through all online: keys
	do {
		const result = await env.KV.list({ prefix: "online:", cursor, limit: 1000 });
		totalCount += result.keys.length;
		cursor = result.list_complete ? undefined : result.cursor;
	} while (cursor);

	// Update current online count cache (5 min TTL, refreshed by cron)
	await env.KV.put("stats:online_count", String(totalCount), { expirationTtl: 300 });

	// Check if new peak
	const peakData = (await env.KV.get("stats:online_peak", "json")) as {
		count: number;
		date: string;
		timestamp: number;
	} | null;

	if (!peakData || totalCount > peakData.count) {
		const newPeak = {
			count: totalCount,
			date: new Date().toISOString().split("T")[0],
			timestamp: now,
		};
		// No TTL — peak is persistent
		await env.KV.put("stats:online_peak", JSON.stringify(newPeak));
	}
}
