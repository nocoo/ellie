import type { PublicStats } from "../../handlers/stats";
import type { Env } from "../env";
import { shanghaiTodayStartUnix } from "../shanghaiTime";
import { cacheGetOrSet } from "./wrap";

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
	const [settings, todayPosts, online] = await Promise.all([
		env.DB.prepare(
			`SELECT key, value FROM settings WHERE key IN (${COUNTERS.map(() => "?").join(",")})`,
		)
			.bind(...COUNTERS)
			.all<{ key: string; value: string }>(),
		countPostsInDay(env),
		env.KV.get("stats:online_count"),
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
		totalOnline: Number.parseInt(online ?? "0", 10) || 0,
		// Legacy fields retained; peaks are no longer computed or displayed.
		peakOnline: 0,
		peakDate: "",
	};
}

export function isPublicStats(value: unknown): value is PublicStats {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const fields = [
		"todayPosts",
		"yesterdayPosts",
		"totalThreads",
		"totalPosts",
		"totalMembers",
		"totalOnline",
		"peakOnline",
	];
	return (
		Object.keys(value).length === fields.length + 1 &&
		fields.every(
			(key) =>
				Object.hasOwn(value, key) && Number.isFinite((value as Record<string, unknown>)[key]),
		) &&
		"peakDate" in value &&
		typeof value.peakDate === "string"
	);
}

export function getPublicStats(
	env: Env,
	ctx?: ExecutionContext,
	source: "business" | "admin" = "business",
): Promise<PublicStats> {
	return cacheGetOrSet(env, ctx, "public-stats", () => loadPublicStats(env), {
		family: "public-stats",
		tier: "SHORT",
		params: {},
		scope: "public",
		source,
		validator: isPublicStats,
	});
}
