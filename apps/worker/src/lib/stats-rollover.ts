import { countPostsInDay } from "./cache/public-stats-read";
import type { Env } from "./env";
import { shanghaiDateLocal, shanghaiTodayStartUnix } from "./shanghaiTime";

/** Missing markers and missed cron runs recover yesterday from committed records. */
export async function checkAndRolloverDailyStats(env: Env): Promise<void> {
	const date = shanghaiDateLocal();
	if ((await env.KV.get("stats:today_date")) === date) return;
	const yesterday = await countPostsInDay(env, shanghaiTodayStartUnix() - 86400);
	const updated = await env.DB.prepare(
		"UPDATE settings SET value = ?, updated_at = ? WHERE key = ?",
	)
		.bind(String(yesterday), Math.floor(Date.now() / 1000), "stats.yesterday_posts")
		.run();
	if (!updated.success) throw new Error("Daily statistics update was not confirmed");
	await env.KV.put("stats:today_date", date);
}
