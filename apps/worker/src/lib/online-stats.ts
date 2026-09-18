// Online statistics aggregation — runs via scheduled cron
import type { Env } from "./env";

/** Approximate recently active members, sampled every five minutes. */
export async function aggregateOnlineStats(env: Env): Promise<void> {
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
}
