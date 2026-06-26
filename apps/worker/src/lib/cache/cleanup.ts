// Retention sweep for `kv_cache_metrics_minute` (migration 0035).
//
// The table is a runtime-only rolling counter (NOT an audit log). Rows
// older than the retention window are deleted outright. The admin KV
// monitor only queries "last N minutes" with N ≤ 1440 (24h), so anything
// older than a few days is dead weight.
//
// Boundary:
//   - Pure D1 op. No KV touch, no admin_log write (retention bookkeeping
//     is not a privileged action that needs an audit trail).
//   - Caller (the worker `scheduled` handler) owns scheduling. Exported
//     for the daily cron unit test so the retention boundary can be
//     pinned without spinning up the scheduled handler.
//   - `ts_minute` is stored as `floor(unix_seconds / 60)` — the cutoff
//     MUST be computed in minutes, never seconds. A seconds-based cutoff
//     would be ~60× larger than every row's ts_minute and silently nuke
//     the entire table.

import type { Env } from "../env";

/** Default retention window: 7 days. */
export const DEFAULT_RETENTION_DAYS = 7;

const MIN_PER_DAY = 24 * 60;

/**
 * Delete `kv_cache_metrics_minute` rows whose `ts_minute` is older than
 * `nowMinute - retentionDays * 1440`.
 *
 * Returns the D1 `meta.changes` count so the cron caller can log it.
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
	const result = await env.DB.prepare("DELETE FROM kv_cache_metrics_minute WHERE ts_minute < ?")
		.bind(cutoff)
		.run();
	const changes = result.meta?.changes ?? 0;
	return Number(changes);
}
