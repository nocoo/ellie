// Historical cumulative counters are incremented atomically in D1.
// Daily statistics are recovered from posts(created_at), with no per-post KV write.
import type { Env } from "./env";

async function incrementCounters(env: Env, keys: string[]): Promise<void> {
	await env.DB.prepare(
		`UPDATE settings SET value = CAST(value AS INTEGER) + 1, updated_at = ? WHERE key IN (${keys.map(() => "?").join(",")})`,
	)
		.bind(Math.floor(Date.now() / 1000), ...keys)
		.run();
}

export function incrementStatsOnThreadCreate(env: Env): Promise<void> {
	return incrementCounters(env, ["stats.total_threads", "stats.total_posts"]);
}

export function incrementStatsOnPostCreate(env: Env): Promise<void> {
	return incrementCounters(env, ["stats.total_posts"]);
}

export function incrementStatsOnUserRegister(env: Env): Promise<void> {
	return incrementCounters(env, ["stats.total_members"]);
}
