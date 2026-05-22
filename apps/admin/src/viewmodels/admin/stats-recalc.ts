// viewmodels/admin/stats-recalc.ts — pure helpers for the job-mode
// statistics recalc UI (Phase E of task #19). Owns the type contract
// shared with worker `StatsJobPayload`, plus pure functions for status
// → badge variant, percent formatting, and concurrent-tick payload
// extraction. The hook (`use-stats-recalc.ts`) layers React state on
// top — keeping these helpers pure lets the admin vitest coverage
// gate (95/90, src/lib + src/viewmodels only) reach 100% on the
// formatting branches without dragging in the act/renderHook plumbing.

import type { AdminBadgeVariant } from "@/viewmodels/admin/badges";

// ---------------------------------------------------------------------------
// Type contract — mirrors worker `apps/worker/src/lib/stats-job.ts`
// ---------------------------------------------------------------------------

/** Per-kind singleton. Worker payload uses dash form "post-forums". */
export type StatsJobKind = "forums" | "threads" | "users" | "post-forums";

export const STATS_JOB_KINDS: readonly StatsJobKind[] = [
	"forums",
	"threads",
	"users",
	"post-forums",
];

export type StatsJobStatus = "running" | "done" | "failed";

/**
 * KV-persisted recalc snapshot returned by both POST `/api/admin/statistics/recalc-<kind>`
 * and GET `/api/admin/statistics/job/<kind>`. Mirrors the worker shape
 * field-for-field; we deliberately do NOT re-export the worker type to
 * avoid a runtime cross-package import — the contract is small and
 * unit-tested on the worker side.
 */
export interface StatsJobSnapshot {
	v: number;
	kind: StatsJobKind;
	status: StatsJobStatus;
	cursor: number;
	processed: number;
	total: number | null;
	updated: number;
	lastBatchUpdated: number;
	batchSize: number;
	startedAt: number;
	lastTickAt: number;
	finishedAt: number | null;
	leaseUntil: number | null;
	error: string | null;
	params: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Error envelope helpers
// ---------------------------------------------------------------------------

/**
 * Wrapped worker error body (see `apps/worker/src/middleware/error.ts`).
 * The 409 `CONCURRENT_TICK` and `RUNNING_JOB_EXISTS` responses carry
 * `details.payload` so the UI can keep the card in sync without an
 * extra GET. 500 `RECALC_FAILED` also carries `payload` (the failed
 * state) plus an error message.
 */
export interface WorkerErrorBody {
	error: {
		code: string;
		message?: string;
		details?: { payload?: StatsJobSnapshot; error?: string } & Record<string, unknown>;
	};
}

/**
 * Conservative structural check — anything not exactly matching the v1
 * snapshot shape is rejected. Used to extract `details.payload` from
 * 409/500 error responses without trusting the wire blindly.
 */
export function isSnapshot(value: unknown): value is StatsJobSnapshot {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.v === "number" &&
		typeof v.kind === "string" &&
		(STATS_JOB_KINDS as readonly string[]).includes(v.kind as string) &&
		typeof v.status === "string" &&
		(v.status === "running" || v.status === "done" || v.status === "failed") &&
		typeof v.cursor === "number" &&
		typeof v.processed === "number" &&
		(v.total === null || typeof v.total === "number") &&
		typeof v.updated === "number" &&
		typeof v.lastBatchUpdated === "number" &&
		typeof v.batchSize === "number" &&
		typeof v.startedAt === "number" &&
		typeof v.lastTickAt === "number" &&
		(v.finishedAt === null || typeof v.finishedAt === "number") &&
		(v.leaseUntil === null || typeof v.leaseUntil === "number") &&
		(v.error === null || typeof v.error === "string")
	);
}

/**
 * Extract the embedded snapshot from a worker error envelope, if any.
 * Returns null for shapes that don't carry one (e.g. non-wrapped
 * errors, validation failures from the proxy layer).
 */
export function extractSnapshotFromError(body: unknown): StatsJobSnapshot | null {
	if (!body || typeof body !== "object") return null;
	const err = (body as { error?: unknown }).error;
	if (!err || typeof err !== "object") return null;
	const details = (err as { details?: unknown }).details;
	if (!details || typeof details !== "object") return null;
	const payload = (details as { payload?: unknown }).payload;
	return isSnapshot(payload) ? payload : null;
}

/**
 * The two non-fatal 409 codes we treat as "keep polling, just update
 * the card payload" — per reviewer msg=8b855b38: a concurrent tick
 * (CONCURRENT_TICK) or a running-job refused-reset (RUNNING_JOB_EXISTS)
 * is NOT a red badge.
 */
export function isSoftConflictCode(code: string): boolean {
	return code === "CONCURRENT_TICK" || code === "RUNNING_JOB_EXISTS";
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Map snapshot status to a Badge variant for the status pill. Uses
 * the same variant tokens as other admin pages (see badges.ts).
 */
export function snapshotStatusVariant(status: StatsJobStatus): AdminBadgeVariant {
	switch (status) {
		case "running":
			return "secondary";
		case "done":
			return "success";
		case "failed":
			return "destructive";
	}
}

/** Localised status label used inside the status badge. */
export function snapshotStatusLabel(status: StatsJobStatus): string {
	switch (status) {
		case "running":
			return "运行中";
		case "done":
			return "已完成";
		case "failed":
			return "失败";
	}
}

/**
 * Format a processed/total ratio as a percentage string.
 *
 *   - `total === null` (kind couldn't estimate denominator) → "—"
 *   - `total === 0`                                          → "100%"
 *     (a sweep over an empty table is logically complete; this avoids
 *      a divide-by-zero in the UI bar)
 *   - clamps to [0, 100] so a stale processed > total doesn't render
 *     past the bar.
 *
 * Returned with no trailing decimal — the bar is the precise reading,
 * the percent is for at-a-glance.
 */
export function formatPercent(processed: number, total: number | null): string {
	if (total === null) return "—";
	if (total <= 0) return "100%";
	const raw = (processed / total) * 100;
	const clamped = Math.max(0, Math.min(100, raw));
	return `${Math.floor(clamped)}%`;
}

/**
 * Numeric percent in [0, 100] for the progress bar width. Same edge
 * cases as `formatPercent`. Returns 0 when total is null so the bar
 * stays empty rather than guessing (the UI shows "—" alongside).
 */
export function percentValue(processed: number, total: number | null): number {
	if (total === null) return 0;
	if (total <= 0) return 100;
	const raw = (processed / total) * 100;
	return Math.max(0, Math.min(100, raw));
}

/**
 * `processed/total` readout. Stable form even when `total` is null —
 * we render `processed / —` so the operator sees the cursor moving on
 * kinds (currently none, but reserved) that skip the count estimate.
 */
export function formatProcessedTotal(processed: number, total: number | null): string {
	const left = processed.toLocaleString("zh-CN");
	const right = total === null ? "—" : total.toLocaleString("zh-CN");
	return `${left} / ${right}`;
}

/** Localised relative-or-absolute time. Used for `lastTickAt` row. */
export function formatTickTime(epochMs: number): string {
	if (!Number.isFinite(epochMs) || epochMs <= 0) return "—";
	const d = new Date(epochMs);
	return d.toLocaleString("zh-CN", { hour12: false });
}

// ---------------------------------------------------------------------------
// Endpoint helpers
// ---------------------------------------------------------------------------

/** POST URL for the recalc-<kind> endpoint (initialize or advance tick). */
export function recalcEndpoint(kind: StatsJobKind): string {
	return `/api/admin/statistics/recalc-${kind}`;
}

/** GET URL for the read-only job snapshot. */
export function jobEndpoint(kind: StatsJobKind): string {
	return `/api/admin/statistics/job/${kind}`;
}
