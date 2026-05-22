// admin/checkin.ts — Admin endpoints for inspecting and editing one
// user's check-in (签到) state. Scope (Phase E):
//
//   GET   /api/admin/users/:id/checkins?from=&to=
//     Returns aggregate row + per-day history rows for the user.
//     Default range: last 90 Shanghai-local days.
//
//   PATCH /api/admin/users/:id/checkins/:dateLocal
//     Body: { checkedIn: boolean }
//     true  → upsert minimal history row (mood='', message='', reward=0)
//             with created_at = Shanghai noon of dateLocal.
//     false → delete the history row for that day.
//     Either branch immediately calls recomputeFromHistory(allowEmptyReset:true)
//     so the rolling aggregate stays consistent with the audit log.
//
//   PATCH /api/admin/users/:id/checkins/streak
//     Body: { streakDays: number }  (non-negative integer)
//     UPDATE user_checkins.streak_days only. Response notes that the
//     next history-based recompute (next admin date edit OR future
//     bulk recompute helper) WILL overwrite this manual value.
//
// All mutations write to admin_logs via writeAdminLog().
// No global list endpoint — Phase E is intentionally user-scoped (see
// Phase E review thread): the admin reaches checkin state through the
// user-detail page, not a separate dashboard.

import type { CheckinHistoryEntry, UserCheckin } from "@ellie/types";
import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import { recomputeFromHistory } from "../../lib/checkinRecompute";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import {
	isValidShanghaiDateLocal,
	shanghaiDateLocal,
	shanghaiNoonUnix,
} from "../../lib/shanghaiTime";
import { errorResponse } from "../../middleware/error";

const checkinConfig: EntityConfig = {
	table: "user_checkins",
	entityName: "CHECKIN",
	auth: "admin",
	columns: "user_id",
	mapper: (row) => row,
	notFoundCode: "CHECKIN_NOT_FOUND",
};

// ─── Path parsing ────────────────────────────────────────────────

interface CheckinPath {
	userId: number;
	tail: string;
}

/**
 * Parse `/api/admin/users/:id/checkins[/...]` into `{ userId, tail }` where
 * tail is whatever follows `/checkins` (e.g. "", "/streak", "/2026-05-12").
 * Returns null when the URL doesn't match the expected shape.
 *
 * We do this manually rather than with parsePathSegment because the
 * trailing token is sometimes a YYYY-MM-DD string (not a number) and the
 * "streak" subroute uses a literal segment, so a one-size-fits-all numeric
 * helper does not apply.
 */
function parseCheckinPath(request: Request): CheckinPath | null {
	const url = new URL(request.url);
	const m = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/checkins(\/.*)?$/);
	if (!m) return null;
	const userId = Number.parseInt(m[1], 10);
	if (Number.isNaN(userId)) return null;
	return { userId, tail: m[2] ?? "" };
}

// ─── Row shapes ──────────────────────────────────────────────────

interface AggregateRow {
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

interface HistoryRow {
	user_id: number;
	date_local: string;
	mood: string;
	message: string;
	reward: number;
	created_at: number;
}

function toUserCheckin(row: AggregateRow): UserCheckin {
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

function toHistoryEntry(row: HistoryRow): CheckinHistoryEntry {
	return {
		userId: row.user_id,
		dateLocal: row.date_local,
		mood: row.mood,
		message: row.message,
		reward: row.reward,
		createdAt: row.created_at,
	};
}

// ─── Common user existence guard ─────────────────────────────────

interface UserGuardOk {
	ok: true;
	username: string;
}

interface UserGuardErr {
	ok: false;
	response: Response;
}

async function ensureUser(
	env: Env,
	userId: number,
	origin: string | undefined,
): Promise<UserGuardOk | UserGuardErr> {
	const user = await env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
		.bind(userId)
		.first<{ id: number; username: string; status: number }>();
	if (!user) {
		return { ok: false, response: errorResponse("USER_NOT_FOUND", 404, undefined, origin) };
	}
	if (user.status === -99) {
		return { ok: false, response: errorResponse("ALREADY_PURGED", 409, undefined, origin) };
	}
	return { ok: true, username: user.username };
}

// ─── GET /api/admin/users/:id/checkins ───────────────────────────

const DEFAULT_RANGE_DAYS = 90;
const MAX_HISTORY_ROWS = 1000; // hard cap so a wide range can't OOM the response

export const getUserCheckins = withEntityAuth(
	checkinConfig,
	async (request, env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const parsed = parseCheckinPath(request);
		if (!parsed || parsed.tail !== "") {
			return errorResponse("INVALID_REQUEST", 400, { message: "Bad checkin path" }, origin);
		}
		const { userId } = parsed;

		const guard = await ensureUser(env, userId, origin);
		if (!guard.ok) return guard.response;

		const url = new URL(request.url);
		const fromParam = url.searchParams.get("from");
		const toParam = url.searchParams.get("to");

		// Default range: last DEFAULT_RANGE_DAYS days through today (Shanghai).
		const today = shanghaiDateLocal();
		const from =
			fromParam ??
			(() => {
				const t = new Date(`${today}T00:00:00Z`);
				const back = new Date(t.getTime() - (DEFAULT_RANGE_DAYS - 1) * 86400_000);
				return shanghaiDateLocal(back);
			})();
		const to = toParam ?? today;

		if (!isValidShanghaiDateLocal(from) || !isValidShanghaiDateLocal(to)) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "from/to must be YYYY-MM-DD calendar dates" },
				origin,
			);
		}
		if (from > to) {
			return errorResponse("INVALID_REQUEST", 400, { message: "from must be <= to" }, origin);
		}

		const [aggregate, history] = await Promise.all([
			env.DB.prepare("SELECT * FROM user_checkins WHERE user_id = ?")
				.bind(userId)
				.first<AggregateRow>(),
			env.DB.prepare(
				`SELECT user_id, date_local, mood, message, reward, created_at
				 FROM checkin_history
				 WHERE user_id = ? AND date_local >= ? AND date_local <= ?
				 ORDER BY date_local DESC
				 LIMIT ?`,
			)
				.bind(userId, from, to, MAX_HISTORY_ROWS)
				.all<HistoryRow>(),
		]);

		const historyRows = history.results ?? [];

		return jsonNoStoreResponse(
			{
				userId,
				username: guard.username,
				checkin: aggregate ? toUserCheckin(aggregate) : null,
				history: historyRows.map(toHistoryEntry),
				range: { from, to },
				truncated: historyRows.length === MAX_HISTORY_ROWS,
			},
			origin,
		);
	},
);

// ─── PATCH /api/admin/users/:id/checkins/:dateLocal ──────────────

export const setCheckinDay = withEntityAuth(
	checkinConfig,
	async (request, env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const parsed = parseCheckinPath(request);
		// tail must be "/<dateLocal>" — exactly one segment after /checkins
		if (!parsed) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Bad checkin path" }, origin);
		}
		const tailMatch = parsed.tail.match(/^\/([^/]+)$/);
		if (!tailMatch) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Bad checkin path" }, origin);
		}
		const dateLocal = tailMatch[1];

		// "streak" is reserved by setStreak — refuse via this route to avoid
		// PATCH /checkins/streak being silently parsed as a date here.
		if (dateLocal === "streak") {
			return errorResponse("INVALID_REQUEST", 400, { message: "Use /streak route" }, origin);
		}

		if (!isValidShanghaiDateLocal(dateLocal)) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "dateLocal must be a valid YYYY-MM-DD calendar date" },
				origin,
			);
		}

		const { userId } = parsed;
		const guard = await ensureUser(env, userId, origin);
		if (!guard.ok) return guard.response;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}

		if (typeof body.checkedIn !== "boolean") {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "checkedIn must be a boolean" },
				origin,
			);
		}

		const checkedIn = body.checkedIn;
		const actor = resolveActor(request, env);

		if (checkedIn) {
			// Upsert minimal history row. created_at = Shanghai noon of
			// dateLocal so recompute's last_checkin_at lands on the
			// business day, not the admin's edit time.
			const createdAt = shanghaiNoonUnix(dateLocal);
			await env.DB.prepare(
				`INSERT INTO checkin_history (user_id, date_local, mood, message, reward, created_at)
				 VALUES (?, ?, '', '', 0, ?)
				 ON CONFLICT(user_id, date_local) DO NOTHING`,
			)
				.bind(userId, dateLocal, createdAt)
				.run();
		} else {
			await env.DB.prepare("DELETE FROM checkin_history WHERE user_id = ? AND date_local = ?")
				.bind(userId, dateLocal)
				.run();
		}

		// Immediate recompute so aggregate matches the audit log. Allow
		// empty-reset because if the admin just deleted the only history
		// row, zero is the intentional truth.
		const result = await recomputeFromHistory(env, userId, { allowEmptyReset: true });

		await writeAdminLog(env, actor, {
			action: checkedIn ? "checkin.history_set" : "checkin.history_clear",
			targetType: "user",
			targetId: userId,
			details: {
				username: guard.username,
				dateLocal,
				checkedIn,
				resultingTotalDays: result.totalDays,
				resultingStreakDays: result.streakDays,
			},
		});

		return jsonNoStoreResponse(
			{
				userId,
				dateLocal,
				checkedIn,
				recompute: result,
			},
			origin,
		);
	},
);

// ─── PATCH /api/admin/users/:id/checkins/streak ──────────────────

const MAX_STREAK_DAYS = 100_000;

export const setStreak = withEntityAuth(checkinConfig, async (request, env): Promise<Response> => {
	const origin = request.headers.get("Origin") ?? undefined;
	const parsed = parseCheckinPath(request);
	if (!parsed || parsed.tail !== "/streak") {
		return errorResponse("INVALID_REQUEST", 400, { message: "Bad checkin path" }, origin);
	}
	const { userId } = parsed;

	const guard = await ensureUser(env, userId, origin);
	if (!guard.ok) return guard.response;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const streakDays = body.streakDays;
	if (
		typeof streakDays !== "number" ||
		!Number.isInteger(streakDays) ||
		streakDays < 0 ||
		streakDays > MAX_STREAK_DAYS
	) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{
				message: `streakDays must be a non-negative integer <= ${MAX_STREAK_DAYS}`,
			},
			origin,
		);
	}

	// Existence guard for the aggregate row — admin shouldn't be able to
	// "edit streak" for a user who has never checked in. Forces the admin
	// to either fill a history row first (which seeds the aggregate via
	// recompute) or to know the user has organic check-in state.
	const existing = await env.DB.prepare("SELECT user_id FROM user_checkins WHERE user_id = ?")
		.bind(userId)
		.first<{ user_id: number }>();
	if (!existing) {
		return errorResponse(
			"CHECKIN_NOT_FOUND",
			404,
			{ message: "No check-in aggregate for this user yet" },
			origin,
		);
	}

	await env.DB.prepare("UPDATE user_checkins SET streak_days = ? WHERE user_id = ?")
		.bind(streakDays, userId)
		.run();

	const actor = resolveActor(request, env);
	await writeAdminLog(env, actor, {
		action: "checkin.streak_edit",
		targetType: "user",
		targetId: userId,
		details: {
			username: guard.username,
			streakDays,
		},
	});

	return jsonNoStoreResponse(
		{
			userId,
			streakDays,
			note: "Manual streak edit will be overwritten by the next history-based recompute (e.g. next admin date edit).",
		},
		origin,
	);
});
