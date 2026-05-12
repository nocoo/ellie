/** One row per user in `user_checkins`. camelCase for frontend consumption. */
export interface UserCheckin {
    userId: number;
    totalDays: number;
    monthDays: number;
    streakDays: number;
    rewardTotal: number;
    lastReward: number;
    mood: string;
    message: string;
    lastCheckinAt: number;
}
/**
 * Public-facing check-in summary attached to user payloads.
 * `level` is resolved from `totalDays` via `getCheckinLevel`; null when the
 * user has never checked in (totalDays = 0).
 */
export interface UserCheckinSummary {
    totalDays: number;
    monthDays: number;
    streakDays: number;
    lastCheckinAt: number;
    level: CheckinLevel | null;
}
/**
 * One row of the `checkin_history` table (migration 0036). Used by the
 * admin user-detail check-in panel to show the per-day audit log behind
 * the rolling aggregates in `user_checkins`.
 *
 * `dateLocal` is the Asia/Shanghai local day in `YYYY-MM-DD` form — the
 * composite PK with `userId` is what gives the at-most-one-per-day
 * idempotency guarantee the public POST handler relies on.
 *
 * `createdAt` is server-side unix seconds at insert time. Useful when
 * the admin needs to distinguish "checked in on day D" from "the request
 * landed at server-time T" (e.g. a 23:59:55 POST that lands at 00:00:01).
 */
export interface CheckinHistoryEntry {
    userId: number;
    dateLocal: string;
    mood: string;
    message: string;
    reward: number;
    createdAt: number;
}
/**
 * Emotion codes from dsu_paulsign (pre_dsu_paulsignemot).
 * Keys = DB `mood` column values; values = Chinese display labels.
 * GIF assets: `public/emot/<code>.gif`
 */
export declare const CHECKIN_MOODS: {
    readonly kx: "开心";
    readonly ng: "难过";
    readonly ym: "郁闷";
    readonly wl: "无聊";
    readonly nu: "怒";
    readonly ch: "擦汗";
    readonly fd: "奋斗";
    readonly yl: "慵懒";
    readonly shuai: "衰";
};
export type CheckinMood = keyof typeof CHECKIN_MOODS;
/**
 * Check-in level tiers — determined by cumulative `total_days`.
 * Ordered ascending; pick the last entry where `minDays <= total_days`.
 */
export declare const CHECKIN_LEVELS: readonly [{
    readonly minDays: 1;
    readonly level: 1;
    readonly label: "初来乍到";
}, {
    readonly minDays: 3;
    readonly level: 2;
    readonly label: "偶尔看看I";
}, {
    readonly minDays: 7;
    readonly level: 3;
    readonly label: "偶尔看看II";
}, {
    readonly minDays: 15;
    readonly level: 4;
    readonly label: "偶尔看看III";
}, {
    readonly minDays: 30;
    readonly level: 5;
    readonly label: "常住居民I";
}, {
    readonly minDays: 60;
    readonly level: 6;
    readonly label: "常住居民II";
}, {
    readonly minDays: 120;
    readonly level: 7;
    readonly label: "常住居民III";
}, {
    readonly minDays: 240;
    readonly level: 8;
    readonly label: "以坛为家I";
}, {
    readonly minDays: 365;
    readonly level: 9;
    readonly label: "以坛为家II";
}, {
    readonly minDays: 750;
    readonly level: 10;
    readonly label: "以坛为家III";
}, {
    readonly minDays: 1500;
    readonly level: 11;
    readonly label: "伴坛终老";
}];
export type CheckinLevel = (typeof CHECKIN_LEVELS)[number];
/**
 * Resolve the check-in level for a given total_days count.
 * Returns the highest matching tier, or `null` if totalDays < 1.
 */
export declare function getCheckinLevel(totalDays: number): CheckinLevel | null;
/** Reward range (coins) for a single check-in. */
export declare const CHECKIN_REWARD_MIN = 20;
export declare const CHECKIN_REWARD_MAX = 500;
/** Check-in time window — Asia/Shanghai hours, half-open [START, END). */
export declare const CHECKIN_HOUR_START = 4;
export declare const CHECKIN_HOUR_END_EXCLUSIVE = 23;
/** Timezone for the check-in window. */
export declare const CHECKIN_TIMEZONE = "Asia/Shanghai";
