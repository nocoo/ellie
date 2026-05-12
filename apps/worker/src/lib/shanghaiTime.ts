// shanghaiTime.ts — Asia/Shanghai-local time helpers shared by the public
// checkin handler and the admin checkin / recompute endpoints.
//
// Cloudflare Workers run in UTC. A naïve `toLocaleString` → `new Date()`
// round-trip re-parses the formatted string as local (UTC) time, shifting
// the Shanghai date boundary by 8 hours. We use
// `Intl.DateTimeFormat.formatToParts()` to extract Shanghai-local fields
// directly and compute Unix timestamps via `Date.UTC`.
//
// All consumers of "Shanghai-local day" semantics (public POST, admin
// list/detail/recompute, history insert) MUST share these primitives so
// the day boundary stays consistent across handlers. Drift here would
// silently break the per-day uniqueness contract on `checkin_history`.

import { CHECKIN_HOUR_END_EXCLUSIVE, CHECKIN_HOUR_START, CHECKIN_TIMEZONE } from "@ellie/types";

export interface ShanghaiParts {
	year: number;
	month: number; // 1-12
	day: number;
	hour: number; // 0-23
}

const shanghaiFmt = new Intl.DateTimeFormat("en-US", {
	timeZone: CHECKIN_TIMEZONE,
	year: "numeric",
	month: "numeric",
	day: "numeric",
	hour: "numeric",
	hour12: false,
});

/** Extract Shanghai year/month/day/hour from a timestamp (defaults to now). */
export function getShanghaiParts(date?: Date): ShanghaiParts {
	const parts = shanghaiFmt.formatToParts(date ?? new Date());
	const map: Record<string, number> = {};
	for (const p of parts) {
		if (p.type !== "literal") map[p.type] = Number(p.value);
	}
	return {
		year: map.year,
		month: map.month,
		day: map.day,
		// Intl hour12:false may yield 24 for midnight — normalize to 0
		hour: map.hour === 24 ? 0 : map.hour,
	};
}

/** Start-of-day (00:00:00) in Asia/Shanghai as unix seconds. */
export function shanghaiTodayStartUnix(): number {
	const { year, month, day } = getShanghaiParts();
	return Math.floor(Date.UTC(year, month - 1, day) / 1000) - 8 * 3600;
}

/**
 * Asia/Shanghai local day formatted as `YYYY-MM-DD`. This is the canonical
 * key used by the `checkin_history` table (migration 0036) — text rather
 * than an integer day-key so admin queries read naturally and the unique
 * constraint is collation-stable. Defaults to "now".
 */
export function shanghaiDateLocal(date?: Date): string {
	const { year, month, day } = getShanghaiParts(date);
	const mm = String(month).padStart(2, "0");
	const dd = String(day).padStart(2, "0");
	return `${year}-${mm}-${dd}`;
}

/** Check if the current Asia/Shanghai hour is within the checkin window. */
export function isWithinCheckinWindow(): boolean {
	const { hour } = getShanghaiParts();
	return hour >= CHECKIN_HOUR_START && hour < CHECKIN_HOUR_END_EXCLUSIVE;
}

/**
 * Validate that an arbitrary string matches the canonical `YYYY-MM-DD`
 * shape used by `checkin_history.date_local` AND represents a real
 * calendar day. Rejecting impossible dates like `2026-02-31` here
 * matters because admin-supplied history rows feed back into
 * `recomputeFromHistory`, which would otherwise produce aggregates
 * that cannot be reproduced from any real calendar walk.
 *
 * The bound year window (2000-2100) is wide enough for any plausible
 * forum lifetime but narrow enough to catch obvious typos / overflow.
 */
export function isValidShanghaiDateLocal(s: unknown): s is string {
	if (typeof s !== "string") return false;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const [y, m, d] = s.split("-").map(Number);
	if (m < 1 || m > 12) return false;
	if (d < 1 || d > 31) return false;
	if (y < 2000 || y > 2100) return false;
	// Real-calendar guard: round-trip through Date.UTC and check the
	// fields survived. Catches Feb 30/31, Apr 31, etc. The UTC date is
	// only used for shape validation; no timezone semantics involved.
	const t = Date.UTC(y, m - 1, d);
	const back = new Date(t);
	if (back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== m || back.getUTCDate() !== d) {
		return false;
	}
	return true;
}

/**
 * Convert a canonical `YYYY-MM-DD` Shanghai date to the unix second of
 * Shanghai-local 12:00 (noon) on that day. Used by admin history fill so
 * `checkin_history.created_at` lands at a stable business-noon timestamp
 * — that lets `recomputeFromHistory` derive `user_checkins.last_checkin_at`
 * without time-travel artifacts (e.g. a 5/12 admin filling 5/8 history
 * would otherwise leave last_checkin_at pointing at 5/12).
 *
 * Caller MUST validate the input via `isValidShanghaiDateLocal` first;
 * this function does no shape checking and returns NaN on garbage.
 */
export function shanghaiNoonUnix(dateLocal: string): number {
	const [y, m, d] = dateLocal.split("-").map(Number);
	// Shanghai is UTC+8 (no DST), so Shanghai 12:00 = UTC 04:00.
	return Math.floor(Date.UTC(y, m - 1, d, 4, 0, 0) / 1000);
}

/**
 * Return the Shanghai-local date one day before `dateLocal`, in canonical
 * `YYYY-MM-DD` form. Used by the streak walker in `recomputeFromHistory`
 * to traverse adjacent days. Caller MUST validate input.
 */
export function shanghaiPrevDay(dateLocal: string): string {
	const [y, m, d] = dateLocal.split("-").map(Number);
	const prev = new Date(Date.UTC(y, m - 1, d) - 86400_000);
	const py = prev.getUTCFullYear();
	const pm = String(prev.getUTCMonth() + 1).padStart(2, "0");
	const pd = String(prev.getUTCDate()).padStart(2, "0");
	return `${py}-${pm}-${pd}`;
}
