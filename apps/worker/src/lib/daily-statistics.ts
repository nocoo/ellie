import {
	applyDailyStatisticsDelta,
	DAILY_STATISTICS_MAX_BYTES,
	type DailyStatistics,
	dailyStatisticsForDay,
	EMPTY_HOME_STATS,
	isDailyStatistics,
	type StatisticsDelta,
	statisticsDay,
} from "@ellie/types";
import type { Env } from "./env";
import { markStatisticsForums, readChangedForums, refreshRecentActivity } from "./recent-activity";

export const DAILY_STATISTICS_KEY = "statistics:daily:v1";
const DELTA_TTL = 7 * 86_400;
const COUNTERS = ["stats.total_threads", "stats.total_posts", "stats.total_members"];

function deltaKey(version: string): string {
	return `${DAILY_STATISTICS_KEY}:delta:${version}`;
}

function serialize(snapshot: DailyStatistics): string {
	if (!isDailyStatistics(snapshot)) throw new Error("Daily statistics aggregation was invalid");
	const body = JSON.stringify(snapshot);
	if (new TextEncoder().encode(body).byteLength > DAILY_STATISTICS_MAX_BYTES - 9) {
		throw new Error("Daily statistics snapshot is too large");
	}
	return body;
}

async function readBase(env: Env): Promise<DailyStatistics | null> {
	const value = await env.KV.get<unknown>(DAILY_STATISTICS_KEY, "json");
	return isDailyStatistics(value) ? value : null;
}

async function readDelta(env: Env, base: DailyStatistics): Promise<DailyStatistics> {
	const value = await env.KV.get<unknown>(deltaKey(base.version), "json");
	return isDailyStatistics(value) &&
		value.version === base.version &&
		value.generatedAt === base.generatedAt
		? value
		: base;
}

export async function readDailyStatistics(
	env: Env,
	now = Date.now(),
): Promise<DailyStatistics | null> {
	try {
		const base = await readBase(env);
		if (!base) return null;
		let current = base;
		try {
			current = await readDelta(env, base);
		} catch {
			console.warn("[statistics] delta read failed");
		}
		return dailyStatisticsForDay(current, now);
	} catch {
		console.warn("[statistics] snapshot read failed");
		return null;
	}
}

export async function refreshDailyStatistics(env: Env, now = Date.now()): Promise<DailyStatistics> {
	const previous = await readBase(env);
	const [changed, activeForums] = await Promise.all([
		readChangedForums(env),
		refreshRecentActivity(env, Math.floor(now / 1000)),
	]);
	const affected = new Set([...changed.forumIds, ...activeForums]);
	const day = statisticsDay(now);
	const start = Math.floor(Date.parse(`${day}T00:00:00+08:00`) / 1000);
	const [counters, forums, groups, dailyPosts, online] = await Promise.all([
		env.DB.prepare(
			`SELECT key, value FROM settings WHERE key IN (${COUNTERS.map(() => "?").join(",")})`,
		)
			.bind(...COUNTERS)
			.all<{ key: string; value: string }>(),
		env.DB.prepare("SELECT id, posts FROM forums").all<{
			id: number;
			posts: number;
		}>(),
		!previous || affected.size > 0
			? env.DB.prepare(`SELECT forum_id, type_id, COUNT(*) AS threads,
			SUM(CASE WHEN sticky != 2 THEN 1 ELSE 0 END) AS local_threads,
			SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END) AS today_threads
			FROM threads INDEXED BY idx_threads_forum WHERE ${previous ? "forum_id IN (SELECT value FROM json_each(?)) AND" : ""}
			sticky >= 0 GROUP BY forum_id, type_id`)
					.bind(start, start + 86_400, ...(previous ? [JSON.stringify([...affected])] : []))
					.all<{
						forum_id: number;
						type_id: number;
						threads: number;
						local_threads: number;
						today_threads: number;
					}>()
			: { success: true, results: [] },
		env.DB.prepare(`SELECT
			COALESCE(SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END), 0) AS today,
			COALESCE(SUM(CASE WHEN created_at < ? THEN 1 ELSE 0 END), 0) AS yesterday
			FROM posts INDEXED BY idx_posts_created WHERE created_at >= ? AND created_at < ?`)
			.bind(start, start, start - 86_400, start + 86_400)
			.all<{ today: number; yesterday: number }>(),
		env.DB.prepare(
			"SELECT COUNT(*) AS count FROM users INDEXED BY idx_users_active_last_activity WHERE status = 0 AND last_activity >= ?",
		)
			.bind(Math.floor(now / 1000) - 1800)
			.all<{ count: number }>(),
	]);
	if ([counters, forums, groups, dailyPosts, online].some((result) => !result.success)) {
		throw new Error("Daily statistics aggregation failed");
	}
	const values = new Map(counters.results.map((row) => [row.key, Number.parseInt(row.value, 10)]));
	const snapshot: DailyStatistics = {
		version: `${now}-${crypto.randomUUID()}`,
		generatedAt: now,
		day,
		stats: {
			...EMPTY_HOME_STATS,
			totalThreads: values.get("stats.total_threads") ?? 0,
			totalPosts: values.get("stats.total_posts") ?? 0,
			totalMembers: values.get("stats.total_members") ?? 0,
			todayPosts: dailyPosts.results[0]?.today ?? 0,
			yesterdayPosts: dailyPosts.results[0]?.yesterday ?? 0,
			totalOnline: online.results[0]?.count ?? 0,
		},
		forums: Object.fromEntries(
			forums.results.map((forum) => [
				forum.id,
				{
					threads:
						!previous || affected.has(forum.id) ? 0 : (previous.forums[forum.id]?.threads ?? 0),
					posts: forum.posts,
					todayThreads: 0,
					types: affected.has(forum.id) ? {} : { ...previous?.forums[forum.id]?.types },
				},
			]),
		),
	};
	for (const row of groups.results) {
		const forum = snapshot.forums[row.forum_id];
		if (!forum) continue;
		forum.threads += row.local_threads;
		forum.todayThreads += row.today_threads;
		forum.types[row.type_id] = row.threads;
	}
	await env.KV.put(DAILY_STATISTICS_KEY, serialize(snapshot));
	for (const key of changed.keys) await env.KV.delete(key);
	return snapshot;
}

export async function recordStatisticsDelta(env: Env, delta: StatisticsDelta): Promise<void> {
	if (delta.forumId !== undefined) await markStatisticsForums(env, [delta.forumId]);
	try {
		const base = await readBase(env);
		if (!base) return;
		const current = await readDelta(env, base);
		const next = applyDailyStatisticsDelta(current, delta);
		// ponytail: KV increments may race at low traffic; the daily rebuild repairs drift.
		await env.KV.put(deltaKey(base.version), serialize(next), { expirationTtl: DELTA_TTL });
	} catch {
		console.warn("[statistics] optimistic update failed");
	}
}
