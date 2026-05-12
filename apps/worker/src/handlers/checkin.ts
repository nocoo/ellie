// handlers/checkin.ts — Daily check-in (签到) endpoints
//
// GET  /api/v1/checkin/status  → current user's checkin state + level
// POST /api/v1/checkin         → perform daily checkin (transactional)

import {
	CHECKIN_HOUR_END_EXCLUSIVE,
	CHECKIN_HOUR_START,
	CHECKIN_MOODS,
	CHECKIN_REWARD_MAX,
	CHECKIN_REWARD_MIN,
	type CheckinMood,
	type UserCheckin,
	getCheckinLevel,
} from "@ellie/types";
import { jsonResponse } from "../lib/response";
import { withAuth, withAuthVerified } from "../lib/routeHelpers";
import {
	getShanghaiParts,
	isWithinCheckinWindow,
	shanghaiDateLocal,
	shanghaiTodayStartUnix,
} from "../lib/shanghaiTime";
import { errorResponse } from "../middleware/error";

// ─── D1 Row Shape ───────────────────────────────────────────

interface D1CheckinRow {
	user_id: number;
	total_days: number;
	month_days: number;
	streak_days: number;
	reward_total: number;
	last_reward: number;
	mood: string;
	message: string;
	last_checkin_at: number;
}

// ─── Mapper ─────────────────────────────────────────────────

function toUserCheckin(row: D1CheckinRow): UserCheckin {
	return {
		userId: row.user_id,
		totalDays: row.total_days,
		monthDays: row.month_days,
		streakDays: row.streak_days,
		rewardTotal: row.reward_total,
		lastReward: row.last_reward,
		mood: row.mood,
		message: row.message,
		lastCheckinAt: row.last_checkin_at,
	};
}

// ─── Timezone-safe helpers ──────────────────────────────────
//
// Shanghai-local date primitives moved to `lib/shanghaiTime.ts` so the
// admin checkin endpoints (Phase E) and the public POST/GET below share
// one source of truth for the day boundary. Drift between the two would
// break the per-day uniqueness contract on `checkin_history`.

/** Random integer in [min, max] (inclusive). */
function randInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

const VALID_MOODS = new Set(Object.keys(CHECKIN_MOODS));
const MAX_MESSAGE_LENGTH = 100;

// ─── GET /api/v1/checkin/status ─────────────────────────────

export const status = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	const row = await env.DB.prepare("SELECT * FROM user_checkins WHERE user_id = ?")
		.bind(user.userId)
		.first<D1CheckinRow>();

	const todayStart = shanghaiTodayStartUnix();
	const checkin = row ? toUserCheckin(row) : null;
	const checkedInToday = checkin ? checkin.lastCheckinAt >= todayStart : false;
	const level = checkin ? getCheckinLevel(checkin.totalDays) : null;
	const withinWindow = isWithinCheckinWindow();

	return jsonResponse(
		{
			checkin,
			checkedInToday,
			level,
			withinWindow,
		},
		origin,
	);
});

// ─── POST /api/v1/checkin ───────────────────────────────────

export const perform = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// ── Parse + validate body ────────────────────────────────
	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const mood = typeof body.mood === "string" ? body.mood.trim() : undefined;
	const rawMessage = typeof body.message === "string" ? body.message.trim() : "";

	if (!mood || !VALID_MOODS.has(mood)) {
		return errorResponse(
			"CHECKIN_INVALID_MOOD",
			400,
			{
				message: `mood must be one of: ${[...VALID_MOODS].join(", ")}`,
			},
			origin,
		);
	}

	const message =
		rawMessage.length > MAX_MESSAGE_LENGTH ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : rawMessage;

	// ── Time window check ────────────────────────────────────
	if (!isWithinCheckinWindow()) {
		return errorResponse(
			"CHECKIN_OUTSIDE_WINDOW",
			403,
			{
				message: `Check-in is only available between ${CHECKIN_HOUR_START}:00 and ${CHECKIN_HOUR_END_EXCLUSIVE}:00 (Asia/Shanghai)`,
			},
			origin,
		);
	}

	// ── Fetch existing checkin row ───────────────────────────
	const existing = await env.DB.prepare("SELECT * FROM user_checkins WHERE user_id = ?")
		.bind(user.userId)
		.first<D1CheckinRow>();

	const todayStart = shanghaiTodayStartUnix();
	const nowUnix = Math.floor(Date.now() / 1000);

	// ── Early duplicate check (fast path) ────────────────────
	if (existing && existing.last_checkin_at >= todayStart) {
		return errorResponse(
			"CHECKIN_ALREADY_DONE",
			409,
			{ message: "Already checked in today" },
			origin,
		);
	}

	// ── Compute reward ───────────────────────────────────────
	const reward = randInt(CHECKIN_REWARD_MIN, CHECKIN_REWARD_MAX);

	// ── Compute streak + month_days ──────────────────────────
	const yesterdayStart = todayStart - 86400;
	let newStreak: number;
	let newMonthDays: number;
	let newTotalDays: number;

	if (existing) {
		// Streak: consecutive if last checkin was yesterday (Shanghai time)
		newStreak =
			existing.last_checkin_at >= yesterdayStart && existing.last_checkin_at < todayStart
				? existing.streak_days + 1
				: 1;

		// Month days: reset if different month (Shanghai time)
		const lastParts = getShanghaiParts(new Date(existing.last_checkin_at * 1000));
		const nowParts = getShanghaiParts();
		const sameMonth = lastParts.year === nowParts.year && lastParts.month === nowParts.month;
		newMonthDays = sameMonth ? existing.month_days + 1 : 1;

		newTotalDays = existing.total_days + 1;
	} else {
		newStreak = 1;
		newMonthDays = 1;
		newTotalDays = 1;
	}

	// ── Conditional write: checkin + coins ───────────────────
	// Both statements use conditions to prevent double-award under
	// concurrent requests. The UPDATE guards with `last_checkin_at < ?`
	// and the INSERT uses ON CONFLICT DO NOTHING. The coins UPDATE
	// uses SQLite `changes() > 0` so it only fires when the immediately
	// preceding checkin statement actually modified a row. This prevents
	// same-second concurrent requests from both awarding coins.
	const checkinSql = existing
		? env.DB.prepare(
				`UPDATE user_checkins
				 SET total_days = ?, month_days = ?, streak_days = ?,
				     reward_total = reward_total + ?, last_reward = ?,
				     mood = ?, message = ?, last_checkin_at = ?
				 WHERE user_id = ? AND last_checkin_at < ?`,
			).bind(
				newTotalDays,
				newMonthDays,
				newStreak,
				reward,
				reward,
				mood,
				message,
				nowUnix,
				user.userId,
				todayStart,
			)
		: env.DB.prepare(
				`INSERT INTO user_checkins
				 (user_id, total_days, month_days, streak_days, reward_total, last_reward, mood, message, last_checkin_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(user_id) DO NOTHING`,
			).bind(
				user.userId,
				newTotalDays,
				newMonthDays,
				newStreak,
				reward,
				reward,
				mood,
				message,
				nowUnix,
			);

	const coinsSql = env.DB.prepare(
		"UPDATE users SET coins = coins + ? WHERE id = ? AND changes() > 0",
	).bind(reward, user.userId);

	// Phase D: per-day audit row in `checkin_history` (migration 0036). The
	// composite PK (user_id, date_local) plus `ON CONFLICT DO NOTHING`
	// double-binds the same idempotency the aggregate UPDATE provides — if
	// two requests race and both pass the early duplicate check, only one
	// `checkin_history` row survives, matching the at-most-one-per-day
	// contract the aggregate streak depends on. The history is intentionally
	// in the same `env.DB.batch` so a partial failure leaves no half-state
	// (D1 batches are atomic).
	const todayDateLocal = shanghaiDateLocal();
	const historySql = env.DB.prepare(
		`INSERT INTO checkin_history (user_id, date_local, mood, message, reward, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, date_local) DO NOTHING`,
	).bind(user.userId, todayDateLocal, mood, message, reward, nowUnix);

	const results = await env.DB.batch([checkinSql, coinsSql, historySql]);

	// ── Concurrent duplicate guard ──────────────────────────
	// If the conditional write was a no-op (another request already
	// updated last_checkin_at to >= todayStart), return duplicate error.
	const checkinChanges = (results[0] as { meta?: { changes?: number } })?.meta?.changes;
	if (checkinChanges === 0) {
		return errorResponse(
			"CHECKIN_ALREADY_DONE",
			409,
			{ message: "Already checked in today" },
			origin,
		);
	}

	// ── Build response ───────────────────────────────────────
	const checkin: UserCheckin = {
		userId: user.userId,
		totalDays: newTotalDays,
		monthDays: newMonthDays,
		streakDays: newStreak,
		rewardTotal: (existing?.reward_total ?? 0) + reward,
		lastReward: reward,
		mood: mood as CheckinMood,
		message,
		lastCheckinAt: nowUnix,
	};

	const level = getCheckinLevel(newTotalDays);

	return jsonResponse(
		{
			checkin,
			reward,
			level,
		},
		origin,
	);
});
