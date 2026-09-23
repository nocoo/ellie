import type { PublicStats } from "../../handlers/stats";
import type { Env } from "../env";
import { shanghaiTodayStartUnix } from "../shanghaiTime";

const ONLINE_WINDOW_SECONDS = 30 * 60;

const COUNTERS = [
	"stats.total_threads",
	"stats.total_posts",
	"stats.total_members",
	"stats.yesterday_posts",
];

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

/** Rebuild from existing counters and committed posts; no business mutations. */
export async function loadPublicStats(env: Env): Promise<PublicStats> {
	const [settings, todayPosts, totalOnline] = await Promise.all([
		env.DB.prepare(
			`SELECT key, value FROM settings WHERE key IN (${COUNTERS.map(() => "?").join(",")})`,
		)
			.bind(...COUNTERS)
			.all<{ key: string; value: string }>(),
		countPostsInDay(env),
		countRecentlyActiveUsers(env),
	]);
	if (!settings.success) throw new Error("Statistics counters could not be read");
	const values = new Map(
		settings.results.map((row) => [row.key, Number.parseInt(row.value, 10) || 0]),
	);
	return {
		todayPosts,
		yesterdayPosts: values.get("stats.yesterday_posts") ?? 0,
		totalThreads: values.get("stats.total_threads") ?? 0,
		totalPosts: values.get("stats.total_posts") ?? 0,
		totalMembers: values.get("stats.total_members") ?? 0,
		totalOnline,
		// Legacy fields retained; peaks are no longer computed or displayed.
		peakOnline: 0,
		peakDate: "",
	};
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
