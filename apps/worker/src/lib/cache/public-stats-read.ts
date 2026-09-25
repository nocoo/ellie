import { EMPTY_HOME_STATS } from "@ellie/types";
import type { PublicStats } from "../../handlers/stats";
import { readDailyStatistics } from "../daily-statistics";
import type { Env } from "../env";
import { shanghaiTodayStartUnix } from "../shanghaiTime";

const ONLINE_WINDOW_SECONDS = 30 * 60;

/** The created_at index bounds this query to committed records for one day. */
export async function countPostsInDay(env: Env, start = shanghaiTodayStartUnix()): Promise<number> {
	const row = await env.DB.prepare(
		"SELECT COUNT(*) AS count FROM posts WHERE created_at >= ? AND created_at < ?",
	)
		.bind(start, start + 86400)
		.first<{ count: number }>();
	if (!row || !Number.isFinite(row.count)) throw new Error("Daily post count was not returned");
	return row.count;
}

export async function loadPublicStats(env: Env): Promise<PublicStats> {
	return (await readDailyStatistics(env))?.stats ?? { ...EMPTY_HOME_STATS };
}

export function countRecentlyActiveUsers(
	env: Env,
	now = Math.floor(Date.now() / 1000),
): Promise<number> {
	return env.DB.prepare(
		`SELECT COUNT(*) AS count FROM users INDEXED BY idx_users_active_last_activity
		 WHERE status = 0 AND last_activity >= ?`,
	)
		.bind(now - ONLINE_WINDOW_SECONDS)
		.first<{ count: number }>()
		.then((row) => {
			if (!row || !Number.isFinite(row.count)) throw new Error("Online count was not returned");
			return row.count;
		});
}
