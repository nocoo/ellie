// checkinRecompute.ts — Rebuild `user_checkins` aggregates from
// `checkin_history` rows. Used by admin endpoints that mutate per-day
// history (PATCH /api/admin/users/:id/checkins/:dateLocal) so the rolling
// totals shown in the public profile / homepage badge stay consistent
// with the audit log.
//
// Source-of-truth contract:
//   - When `checkin_history` has any rows for the user, those rows ARE
//     the truth: `total_days` / `month_days` / `last_checkin_at` /
//     `reward_total` / `streak_days` are derived purely from history.
//   - When `checkin_history` is empty, behavior depends on `allowEmptyReset`:
//       * `false` (default): leave the existing aggregate untouched. This is
//         the legacy-safe path for users with pre-migration aggregates that
//         were never backfilled into history. Without this guard a stray
//         recompute would zero out years of legitimate streak data.
//       * `true`: zero the aggregate. Used by admin "PATCH date checkedIn=false"
//         when the deletion drained the user's only history row — the empty
//         state is intentional, not a missing backfill.
//
// Streak rule (matches public POST handler in handlers/checkin.ts):
//   - Walk backward from the most-recent history row. The user has a
//     non-zero streak iff the latest dateLocal is "today" or "yesterday"
//     in Asia/Shanghai. Then count adjacent days until a gap.
//
// Month rule:
//   - `month_days` = count of history rows whose dateLocal starts with the
//     CURRENT Shanghai YYYY-MM. Same semantics as the public POST counter.

import type { Env } from "./env";
import { getShanghaiParts, shanghaiDateLocal, shanghaiPrevDay } from "./shanghaiTime";

interface CheckinHistoryRow {
	date_local: string;
	reward: number;
	created_at: number;
}

export interface RecomputeOptions {
	/**
	 * When true, an empty `checkin_history` for the user resets the
	 * aggregate row (or deletes it if absent). Defaults to false so
	 * legacy aggregates without a backfilled history are preserved.
	 */
	allowEmptyReset?: boolean;
}

export interface RecomputeResult {
	totalDays: number;
	monthDays: number;
	streakDays: number;
	rewardTotal: number;
	lastCheckinAt: number;
	historyRows: number;
	/** True if the call was a no-op because history was empty + !allowEmptyReset. */
	skipped: boolean;
}

/**
 * Recompute `user_checkins` for one user from `checkin_history`. Idempotent.
 *
 * The aggregate row is upserted: if the user has no `user_checkins` row yet
 * but does have history, one is inserted; if history is empty + reset is
 * allowed, the existing row (if any) is overwritten with zeros.
 *
 * `mood` / `message` / `last_reward` are intentionally NOT touched — they
 * carry user-supplied free text from the most recent check-in moment, not
 * derivable from history without losing the latest user intent. Admin
 * cannot "see what the user typed" through recompute; that would require a
 * separate audit trail per check-in. Existing values are preserved on
 * UPDATE; for fresh INSERT they default to empty.
 */
export async function recomputeFromHistory(
	env: Env,
	userId: number,
	opts: RecomputeOptions = {},
): Promise<RecomputeResult> {
	const { allowEmptyReset = false } = opts;

	const historyResult = await env.DB.prepare(
		"SELECT date_local, reward, created_at FROM checkin_history WHERE user_id = ? ORDER BY date_local",
	)
		.bind(userId)
		.all<CheckinHistoryRow>();

	const rows = historyResult.results ?? [];

	if (rows.length === 0) {
		if (!allowEmptyReset) {
			return {
				totalDays: 0,
				monthDays: 0,
				streakDays: 0,
				rewardTotal: 0,
				lastCheckinAt: 0,
				historyRows: 0,
				skipped: true,
			};
		}
		// Reset: zero the aggregate (preserve mood/message free text).
		await env.DB.prepare(
			`INSERT INTO user_checkins (user_id, total_days, month_days, streak_days, reward_total, last_reward, mood, message, last_checkin_at)
			 VALUES (?, 0, 0, 0, 0, 0, '', '', 0)
			 ON CONFLICT(user_id) DO UPDATE SET
			   total_days = 0, month_days = 0, streak_days = 0,
			   reward_total = 0, last_reward = 0, last_checkin_at = 0`,
		)
			.bind(userId)
			.run();
		return {
			totalDays: 0,
			monthDays: 0,
			streakDays: 0,
			rewardTotal: 0,
			lastCheckinAt: 0,
			historyRows: 0,
			skipped: false,
		};
	}

	// total_days: every history row counts (composite PK enforces one per day).
	const totalDays = rows.length;

	// reward_total: sum of all reward fields.
	const rewardTotal = rows.reduce((acc, r) => acc + (r.reward ?? 0), 0);

	// last_checkin_at: max(created_at) — for admin-filled rows this is
	// shanghaiNoonUnix(dateLocal); for organic public POSTs it's Date.now()
	// at insert. Either way, the most recent business activity timestamp.
	const lastCheckinAt = rows.reduce((acc, r) => Math.max(acc, r.created_at ?? 0), 0);

	// month_days: rows in the CURRENT Shanghai month — matches the public
	// POST counter semantics (handlers/checkin.ts uses Shanghai parts of "now").
	const now = getShanghaiParts();
	const monthPrefix = `${now.year}-${String(now.month).padStart(2, "0")}-`;
	const monthDays = rows.filter((r) => r.date_local.startsWith(monthPrefix)).length;

	// streak_days: walk backward from the most recent row. Latest row
	// must be today or yesterday (Shanghai) — otherwise the streak is broken.
	const today = shanghaiDateLocal();
	const yesterday = shanghaiPrevDay(today);
	const sortedDesc = [...rows].sort((a, b) => (a.date_local < b.date_local ? 1 : -1));
	let streakDays = 0;
	if (sortedDesc[0].date_local === today || sortedDesc[0].date_local === yesterday) {
		streakDays = 1;
		let cursor = sortedDesc[0].date_local;
		for (let i = 1; i < sortedDesc.length; i += 1) {
			const prev = shanghaiPrevDay(cursor);
			if (sortedDesc[i].date_local === prev) {
				streakDays += 1;
				cursor = prev;
			} else {
				break;
			}
		}
	}

	// Upsert. mood/message/last_reward intentionally preserved on UPDATE.
	await env.DB.prepare(
		`INSERT INTO user_checkins (user_id, total_days, month_days, streak_days, reward_total, last_reward, mood, message, last_checkin_at)
		 VALUES (?, ?, ?, ?, ?, 0, '', '', ?)
		 ON CONFLICT(user_id) DO UPDATE SET
		   total_days = excluded.total_days,
		   month_days = excluded.month_days,
		   streak_days = excluded.streak_days,
		   reward_total = excluded.reward_total,
		   last_checkin_at = excluded.last_checkin_at`,
	)
		.bind(userId, totalDays, monthDays, streakDays, rewardTotal, lastCheckinAt)
		.run();

	return {
		totalDays,
		monthDays,
		streakDays,
		rewardTotal,
		lastCheckinAt,
		historyRows: rows.length,
		skipped: false,
	};
}
