// lib/stats-rollover.ts — Daily rollover for today/yesterday posts counters
// Called by scheduled cron to detect day change and rotate counters.

import type { Env } from "./env";

const KV_TODAY_POSTS = "stats:today_posts";
const KV_TODAY_DATE = "stats:today_date";
const SETTINGS_YESTERDAY_POSTS = "stats.yesterday_posts";

/**
 * Get current date in Asia/Shanghai timezone as YYYY-MM-DD.
 */
function getShanghaiDate(): string {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	return formatter.format(new Date());
}

/**
 * Check if the day has changed and perform rollover if needed.
 * Called by cron handler (every 5 minutes) to detect midnight crossover.
 *
 * Rollover logic:
 * 1. Get current Shanghai date
 * 2. Compare with KV stored date
 * 3. If different:
 *    - Move today_posts → settings.stats.yesterday_posts
 *    - Reset today_posts to 0
 *    - Update today_date to new date
 */
export async function checkAndRolloverDailyStats(env: Env): Promise<void> {
	const currentDate = getShanghaiDate();
	const storedDate = await env.KV.get(KV_TODAY_DATE);

	// First run or same day — nothing to do
	if (!storedDate) {
		// Initialize the date marker on first run
		await env.KV.put(KV_TODAY_DATE, currentDate, { expirationTtl: 86_400 });
		return;
	}

	if (storedDate === currentDate) {
		// Same day — no rollover needed
		return;
	}

	// Day changed — perform rollover
	console.log(`[stats-rollover] Day changed: ${storedDate} → ${currentDate}`);

	// Get today's posts count before reset
	const todayPostsStr = await env.KV.get(KV_TODAY_POSTS);
	const todayPosts = todayPostsStr ? Number.parseInt(todayPostsStr, 10) : 0;

	// Move today's posts to yesterday in settings table
	await env.DB.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?")
		.bind(String(todayPosts), Math.floor(Date.now() / 1000), SETTINGS_YESTERDAY_POSTS)
		.run();

	// Reset today's counter and update date marker
	await Promise.all([
		env.KV.put(KV_TODAY_POSTS, "0", { expirationTtl: 86_400 }),
		env.KV.put(KV_TODAY_DATE, currentDate, { expirationTtl: 86_400 }),
	]);

	console.log(`[stats-rollover] Rolled over ${todayPosts} posts to yesterday`);
}
