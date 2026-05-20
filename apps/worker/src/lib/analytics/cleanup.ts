// Cleanup helper for the P5 analytics page-view aggregate.
//
// The `analytics_daily_targets` table is a runtime-only rolling counter
// (NOT an audit log) — rows older than the retention window are deleted
// outright. The 48h default mirrors the dashboard's "今天 + 一窗追溯"
// scope: KPI + list rendering only touches `date_local = today`, and the
// previous day is kept around briefly so a long-running tab that loads
// after midnight Shanghai-time can still resolve labels for in-flight
// rows. Anything older than that is dead weight.

import type { Env } from "../env";

/** Default retention window: 48 hours. */
export const DEFAULT_RETENTION_HOURS = 48;

const SEC_PER_HOUR = 3600;

/**
 * Delete `analytics_daily_targets` rows whose `last_seen_at` is older
 * than `nowSec - retentionHours * 3600`.
 *
 * Returns the D1 `meta.changes` count so the cron caller can log it.
 *
 * Boundary:
 *   - Pure D1 op. No KV touch, no collector touch, no admin_log write
 *     (the aggregate is not PII — its retention sweep is bookkeeping,
 *     not an admin action that needs an audit trail).
 *   - Caller (the worker `scheduled` handler) owns scheduling. This
 *     helper is also exported for the daily cron unit test so the
 *     retention boundary can be pinned without spinning up the
 *     scheduled handler.
 */
export async function cleanupAnalyticsDailyTargets(
	env: Env,
	retentionHours: number = DEFAULT_RETENTION_HOURS,
	nowSec: number = Math.floor(Date.now() / 1000),
): Promise<number> {
	if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
		return 0;
	}
	const cutoff = nowSec - Math.floor(retentionHours * SEC_PER_HOUR);
	const result = await env.DB.prepare("DELETE FROM analytics_daily_targets WHERE last_seen_at < ?")
		.bind(cutoff)
		.run();
	const changes = result.meta?.changes ?? 0;
	return Number(changes);
}
