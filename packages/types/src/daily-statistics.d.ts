import type { HomeStats } from "./home";
export declare const DAILY_STATISTICS_PATH = "/api/internal/statistics/snapshot";
export declare const DAILY_STATISTICS_MAX_BYTES: number;
export declare const DAILY_STATISTICS_MAX_FORUMS = 2048;
export declare const DAILY_STATISTICS_MAX_TYPES = 256;
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
export declare const EMPTY_HOME_STATS: Readonly<HomeStats>;
export declare function isDailyStatistics(value: unknown): value is DailyStatistics;
export declare function statisticsDay(now?: number): string;
export declare function dailyStatisticsForDay(snapshot: DailyStatistics, now?: number): DailyStatistics;
export declare function applyDailyStatisticsDelta(snapshot: DailyStatistics, delta: StatisticsDelta, now?: number): DailyStatistics;
