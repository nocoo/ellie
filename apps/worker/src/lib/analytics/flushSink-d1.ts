// D1 flush sink for the P5 analytics page-view collector.
//
// The in-isolate collector (`collect.ts`) drains aggregated rows via the
// `FlushSink` contract; this module provides the production implementation
// that UPSERTs each row into `analytics_daily_targets`.
//
// Boundaries:
//   - Pure persistence. No header reading, no UA classification, no IP
//     resolution — those happen at the ingest handler before
//     `recordPageView`.
//   - One D1 `batch()` per flush so the snapshot is applied atomically:
//     a partial failure leaves either every row or no row applied, never
//     half. The collector swap-then-drain pattern means losing the
//     snapshot on failure is at most one 30s window of samples.
//   - UPSERT conflict target MUST exactly mirror the PRIMARY KEY column
//     order pinned by migration 0043 + drift guard
//     (tests/unit/migration-0043-schema.test.ts).

import type { Env } from "../env";
import type { AggregateRow } from "./types";

/**
 * Build the prepared statement for one aggregate row's UPSERT. Exported
 * for tests so the SQL shape can be pinned without spinning up D1.
 */
export function buildUpsertSql(): string {
	return `INSERT INTO analytics_daily_targets
		(date_local, path_kind, target_id, user_id, bot_class, count, first_seen_at, last_seen_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(date_local, path_kind, target_id, user_id, bot_class) DO UPDATE SET
			count = count + excluded.count,
			first_seen_at = MIN(first_seen_at, excluded.first_seen_at),
			last_seen_at = MAX(last_seen_at, excluded.last_seen_at)`;
}

/**
 * Persist a drained aggregate snapshot to D1.
 *
 * Contract:
 *   - Empty input → no-op (no D1 round-trip).
 *   - Failures throw; the collector's `scheduleFlush` wrapper catches and
 *     logs them. Never let an error bubble out into the request hot path.
 */
export async function d1FlushSink(env: Env, rows: AggregateRow[]): Promise<void> {
	if (rows.length === 0) return;
	const sql = buildUpsertSql();
	const statements = rows.map((r) =>
		env.DB.prepare(sql).bind(
			r.dateLocal,
			r.pathKind,
			r.targetId,
			r.userId,
			r.botClass,
			r.count,
			r.firstSeenAt,
			r.lastSeenAt,
		),
	);
	const FLUSH_BATCH_SIZE = 100;
	for (let i = 0; i < statements.length; i += FLUSH_BATCH_SIZE) {
		await env.DB.batch(statements.slice(i, i + FLUSH_BATCH_SIZE));
	}
}
