import { recordStatisticsDelta } from "./daily-statistics";
import type { Env } from "./env";

async function incrementCounters(env: Env, keys: string[]): Promise<void> {
	await env.DB.prepare(
		`UPDATE settings SET value = CAST(value AS INTEGER) + 1, updated_at = ? WHERE key IN (${keys.map(() => "?").join(",")})`,
	)
		.bind(Math.floor(Date.now() / 1000), ...keys)
		.run();
}

export async function incrementStatsOnThreadCreate(
	env: Env,
	forumId?: number,
	typeId?: number,
): Promise<void> {
	await incrementCounters(env, ["stats.total_threads", "stats.total_posts"]);
	await recordStatisticsDelta(env, { kind: "thread", forumId, typeId });
}

export async function incrementStatsOnPostCreate(env: Env, forumId?: number): Promise<void> {
	await incrementCounters(env, ["stats.total_posts"]);
	await recordStatisticsDelta(env, { kind: "post", forumId });
}

export async function incrementStatsOnUserRegister(env: Env): Promise<void> {
	await incrementCounters(env, ["stats.total_members"]);
	await recordStatisticsDelta(env, { kind: "member" });
}
