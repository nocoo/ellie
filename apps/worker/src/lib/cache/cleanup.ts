// Retention sweep for hourly metrics and the retiring minute table.
//
// These rolling observations are not an audit log. The monitor queries at
// most seven days; the daily cron deletes older hourly and legacy minute rows.
//
// Boundary:
//   - Pure D1 op. No KV touch, no admin_log write (retention bookkeeping
//     is not a privileged action that needs an audit trail).
//   - Caller (the worker `scheduled` handler) owns scheduling. Exported
//     for the daily cron unit test so the retention boundary can be
//     pinned without spinning up the scheduled handler.
//   - Each cutoff uses its table's unit (epoch minutes or epoch hours),
//     never epoch seconds, which would incorrectly delete current rows.

import type { Env } from "../env";

/** Default retention window: 7 days. */
export const DEFAULT_RETENTION_DAYS = 7;

const MIN_PER_DAY = 24 * 60;

/**
 * Retain the legacy export name while pruning both metric tables.
 *
 * Returns the sum of confirmed D1 `meta.changes` counts for the cron log.
 *
 * Refuses to run when `retentionDays` is non-finite or <= 0 — this guard
 * prevents an accidental `0` (or NaN from a bad env var) from truncating
 * the entire table.
 */
export async function cleanupKvCacheMetricsMinute(
	env: Env,
	retentionDays: number = DEFAULT_RETENTION_DAYS,
	nowSec: number = Math.floor(Date.now() / 1000),
): Promise<number> {
	if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
		return 0;
	}
	const nowMinute = Math.floor(nowSec / 60);
	const cutoff = nowMinute - Math.floor(retentionDays * MIN_PER_DAY);
	const hourCutoff = Math.floor(nowSec / 3600) - Math.floor(retentionDays * 24);
	const results = await env.DB.batch([
		env.DB.prepare("DELETE FROM kv_cache_metrics_minute WHERE ts_minute < ?").bind(cutoff),
		env.DB.prepare("DELETE FROM kv_cache_metrics_hour WHERE ts_hour < ?").bind(hourCutoff),
	]);
	if (results.length !== 2 || results.some((result) => !result.success))
		throw new Error("Metric retention writes were not confirmed");
	return results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
}
