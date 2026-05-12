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

/**
 * Public-facing check-in summary attached to user payloads.
 * `level` is resolved from `totalDays` via `getCheckinLevel`; null when the
 * user has never checked in (totalDays = 0).
 */
export interface UserCheckinSummary {
	totalDays: number;
	monthDays: number;
	streakDays: number;
	lastCheckinAt: number; // unix seconds, 0 if never
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
	dateLocal: string; // YYYY-MM-DD, Asia/Shanghai local day
	mood: string;
	message: string;
	reward: number;
	createdAt: number; // unix seconds
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

/** Check-in time window — Asia/Shanghai hours, half-open [START, END). */
export const CHECKIN_HOUR_START = 4; // inclusive: 04:00 可签
export const CHECKIN_HOUR_END_EXCLUSIVE = 23; // exclusive: 23:00 起不可签

/** Timezone for the check-in window. */
export const CHECKIN_TIMEZONE = "Asia/Shanghai";
