// checkin.ts — Daily check-in (签到) types and constants
//
// Maps to D1 `user_checkins` table (migration 0033).
// Source: Discuz dsu_paulsign plugin (pre_dsu_paulsign / pre_dsu_paulsign2).

// ─── Entity ─────────────────────────────────────────────────

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
	lastCheckinAt: number; // unix seconds
}

// ─── Moods ──────────────────────────────────────────────────

/**
 * Emotion codes from dsu_paulsign (pre_dsu_paulsignemot).
 * Keys = DB `mood` column values; values = Chinese display labels.
 * GIF assets: `public/emot/<code>.gif`
 */
export const CHECKIN_MOODS = {
	kx: "开心",
	ng: "难过",
	ym: "郁闷",
	wl: "无聊",
	nu: "怒",
	ch: "擦汗",
	fd: "奋斗",
	yl: "慵懒",
	shuai: "衰",
} as const;

export type CheckinMood = keyof typeof CHECKIN_MOODS;

// ─── Levels ─────────────────────────────────────────────────

/**
 * Check-in level tiers — determined by cumulative `total_days`.
 * Ordered ascending; pick the last entry where `minDays <= total_days`.
 */
export const CHECKIN_LEVELS = [
	{ minDays: 1, level: 1, label: "初来乍到" },
	{ minDays: 3, level: 2, label: "偶尔看看I" },
	{ minDays: 7, level: 3, label: "偶尔看看II" },
	{ minDays: 15, level: 4, label: "偶尔看看III" },
	{ minDays: 30, level: 5, label: "常住居民I" },
	{ minDays: 60, level: 6, label: "常住居民II" },
	{ minDays: 120, level: 7, label: "常住居民III" },
	{ minDays: 240, level: 8, label: "以坛为家I" },
	{ minDays: 365, level: 9, label: "以坛为家II" },
	{ minDays: 750, level: 10, label: "以坛为家III" },
	{ minDays: 1500, level: 11, label: "伴坛终老" },
] as const;

export type CheckinLevel = (typeof CHECKIN_LEVELS)[number];

/**
 * Resolve the check-in level for a given total_days count.
 * Returns the highest matching tier, or `null` if totalDays < 1.
 */
export function getCheckinLevel(totalDays: number): CheckinLevel | null {
	let result: CheckinLevel | null = null;
	for (const tier of CHECKIN_LEVELS) {
		if (totalDays >= tier.minDays) {
			result = tier;
		} else {
			break;
		}
	}
	return result;
}

// ─── Reward Config ──────────────────────────────────────────

/** Reward range (coins) for a single check-in. */
export const CHECKIN_REWARD_MIN = 20;
export const CHECKIN_REWARD_MAX = 500;

/** Check-in time window (Asia/Shanghai hours, inclusive). */
export const CHECKIN_HOUR_START = 4; // 04:00
export const CHECKIN_HOUR_END = 23; // 23:00

/** Timezone for the check-in window. */
export const CHECKIN_TIMEZONE = "Asia/Shanghai";
