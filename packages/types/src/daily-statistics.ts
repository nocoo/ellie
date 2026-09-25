import type { HomeStats } from "./home";

export const DAILY_STATISTICS_PATH = "/api/internal/statistics/snapshot";
export const DAILY_STATISTICS_MAX_BYTES = 2 * 1024 * 1024;
export const DAILY_STATISTICS_MAX_FORUMS = 2048;
export const DAILY_STATISTICS_MAX_TYPES = 256;

export interface DailyForumStatistics {
	threads: number;
	posts: number;
	todayThreads: number;
	types: Record<string, number>;
}

export interface DailyStatistics {
	version: string;
	generatedAt: number;
	day: string;
	stats: HomeStats;
	forums: Record<string, DailyForumStatistics>;
}

export interface StatisticsDelta {
	kind: "thread" | "post" | "member";
	forumId?: number;
	typeId?: number;
}

export const EMPTY_HOME_STATS: Readonly<HomeStats> = {
	todayPosts: 0,
	yesterdayPosts: 0,
	totalThreads: 0,
	totalPosts: 0,
	totalMembers: 0,
	totalOnline: 0,
	peakOnline: 0,
	peakDate: "",
};

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function count(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isDailyStatistics(value: unknown): value is DailyStatistics {
	if (
		!record(value) ||
		typeof value.version !== "string" ||
		!/^\d+-[a-f0-9-]{36}$/.test(value.version) ||
		!count(value.generatedAt) ||
		typeof value.day !== "string" ||
		!/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
		!record(value.stats) ||
		typeof value.stats.peakDate !== "string" ||
		!record(value.forums) ||
		Object.keys(value.forums).length > DAILY_STATISTICS_MAX_FORUMS ||
		value.stats.peakDate.length > 10
	)
		return false;
	const stats = value.stats;
	if (Object.keys(EMPTY_HOME_STATS).some((key) => key !== "peakDate" && !count(stats[key]))) {
		return false;
	}
	return Object.entries(value.forums).every(
		([id, forum]) =>
			/^[1-9]\d*$/.test(id) &&
			record(forum) &&
			count(forum.threads) &&
			count(forum.posts) &&
			count(forum.todayThreads) &&
			record(forum.types) &&
			Object.keys(forum.types).length <= DAILY_STATISTICS_MAX_TYPES &&
			Object.entries(forum.types).every(([typeId, total]) => /^\d+$/.test(typeId) && count(total)),
	);
}

export function statisticsDay(now = Date.now()): string {
	return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}

export function dailyStatisticsForDay(
	snapshot: DailyStatistics,
	now = Date.now(),
): DailyStatistics {
	const day = statisticsDay(now);
	if (snapshot.day === day) return snapshot;
	return {
		...snapshot,
		day,
		stats: {
			...snapshot.stats,
			todayPosts: 0,
			yesterdayPosts:
				snapshot.day === statisticsDay(now - 86_400_000) ? snapshot.stats.todayPosts : 0,
		},
		forums: Object.fromEntries(
			Object.entries(snapshot.forums).map(([id, forum]) => [id, { ...forum, todayThreads: 0 }]),
		),
	};
}

export function applyDailyStatisticsDelta(
	snapshot: DailyStatistics,
	delta: StatisticsDelta,
	now = Date.now(),
): DailyStatistics {
	const current = dailyStatisticsForDay(snapshot, now);
	const next = { ...current, stats: { ...current.stats }, forums: { ...current.forums } };
	if (delta.kind === "member") {
		next.stats.totalMembers++;
		return next;
	}
	next.stats.todayPosts++;
	next.stats.totalPosts++;
	if (delta.kind === "thread") next.stats.totalThreads++;
	if (delta.forumId !== undefined && Number.isSafeInteger(delta.forumId) && delta.forumId > 0) {
		const old = next.forums[delta.forumId];
		const forum = old
			? { ...old, types: { ...old.types } }
			: { threads: 0, posts: 0, todayThreads: 0, types: {} as Record<string, number> };
		forum.posts++;
		if (delta.kind === "thread") {
			forum.threads++;
			forum.todayThreads++;
			const typeId = delta.typeId ?? 0;
			if (Number.isSafeInteger(typeId) && typeId >= 0)
				forum.types[typeId] = (forum.types[typeId] ?? 0) + 1;
		}
		next.forums[delta.forumId] = forum;
	}
	return next;
}
