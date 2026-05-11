// In-isolate KV cache op-metrics accumulator (B.1).
//
// Scope: business cache families only (forum tree/summary/meta, thread
// list page1, user mini, settings, public stats). Short-lived auth /
// rate-limit / online-presence / activity-throttle families are NOT
// instrumented — they're high-volume and write-only enough that
// counters would dominate D1 load without changing operator decisions.
//
// Op model:
//   - Every read attempt records `read`, plus exactly one of `hit` or
//     `miss` (or `error` if KV.get threw). This means `read = hit + miss
//     + error_on_read` for any family/minute window.
//   - Every successful write-back records `write`. KV.put failures
//     record `error`.
//   - `bumpGen` invalidations record `bump` for the affected business
//     family. Single-key deletes record `delete`.
//
// Lifecycle:
//   - `recordKvOp(family, op)` bumps in an in-isolate Map keyed by
//     `(family, ts_minute, op)`. Pure memory ops, no IO.
//   - `scheduleMetricsFlush(env, ctx)` is called from request hot paths
//     (`cacheGetOrSet`, user-cache batch loader, settings/stats
//     handlers). It defers the actual D1 write through `ctx.waitUntil`
//     so the response is never blocked. A `flushedRecently` guard
//     prevents flushing more than once per `FLUSH_INTERVAL_MS` per
//     isolate, but the FIRST observation in an isolate flushes
//     immediately so low-traffic paths still surface metrics.
//   - The flush itself does a SWAP (lift current snapshot, replace
//     with empty Map) BEFORE writing to D1. A write failure loses at
//     most one window's worth of counters and never causes
//     double-counting on retry — the snapshot is detached from the
//     live accumulator when the UPSERT runs.
//
// D1 contract:
//   - Table `kv_cache_metrics_minute(family, ts_minute, op, count)`
//     created in migration 0035. Single statement per row uses
//     `INSERT ... ON CONFLICT(family, ts_minute, op) DO UPDATE` so
//     concurrent isolates merge cleanly.
//   - All errors are caught and `console.warn`'d. Metrics are best-effort.

import type { Env } from "../env";

/**
 * Whitelisted op dimensions. Kept narrow on purpose so the admin UI
 * series schema stays predictable and the D1 table doesn't grow
 * one row per ad-hoc verb.
 */
export type KvOp = "read" | "hit" | "miss" | "write" | "bump" | "delete" | "error";

const KV_OPS: readonly KvOp[] = ["read", "hit", "miss", "write", "bump", "delete", "error"];
const KV_OP_SET: ReadonlySet<string> = new Set<string>(KV_OPS);

const BUCKETS: Map<string, number> = new Map();

/** Flush at most once every 30 seconds per isolate. */
const FLUSH_INTERVAL_MS = 30_000;
/**
 * Timestamp of the last flush. Initialized to 0; the first
 * `scheduleMetricsFlush` after observation triggers an immediate flush
 * so even low-traffic paths surface counters in the admin UI within
 * one request. Subsequent flushes are throttled by `FLUSH_INTERVAL_MS`.
 */
let lastFlushAt = 0;

/**
 * Composite key separator. U+0001 (Start of Heading) cannot appear in
 * any family / op string we use, so split-on-separator round-trips
 * cleanly even though `family` itself contains `:`.
 */
const KEY_SEP = "";

function bucketKey(family: string, tsMinute: number, op: KvOp): string {
	return `${family}${KEY_SEP}${tsMinute}${KEY_SEP}${op}`;
}

function currentMinute(now = Date.now()): number {
	return Math.floor(now / 60_000);
}

/**
 * Record one KV op observation. Silently ignores unknown ops so that
 * adding a new verb in code can never break metrics writes if the
 * whitelist is forgotten — the call becomes a no-op until the type is
 * widened above.
 */
export function recordKvOp(family: string, op: KvOp): void {
	if (!KV_OP_SET.has(op)) return;
	const ts = currentMinute();
	const key = bucketKey(family, ts, op);
	BUCKETS.set(key, (BUCKETS.get(key) ?? 0) + 1);
}

// ─── Legacy single-op helpers retained for callsite ergonomics ────

export function recordHit(family: string): void {
	recordKvOp(family, "hit");
}
export function recordMiss(family: string): void {
	recordKvOp(family, "miss");
}
export function recordError(family: string): void {
	recordKvOp(family, "error");
}
export function recordRead(family: string): void {
	recordKvOp(family, "read");
}
export function recordWrite(family: string): void {
	recordKvOp(family, "write");
}
export function recordBump(family: string): void {
	recordKvOp(family, "bump");
}
export function recordDelete(family: string): void {
	recordKvOp(family, "delete");
}

/**
 * Snapshot the current in-isolate buckets and clear the live accumulator.
 * Public for tests; production callers should use `scheduleMetricsFlush`.
 */
export function swapSnapshot(): Map<string, number> {
	if (BUCKETS.size === 0) return new Map();
	const snap = new Map(BUCKETS);
	BUCKETS.clear();
	return snap;
}

/**
 * Persist a snapshot to D1. Returns the number of rows attempted.
 * Errors are logged and swallowed — metrics writes MUST NOT throw.
 */
export async function flushSnapshot(env: Env, snap: Map<string, number>): Promise<number> {
	if (snap.size === 0) return 0;
	let attempted = 0;
	for (const [key, count] of snap.entries()) {
		const parts = key.split(KEY_SEP);
		if (parts.length !== 3) continue;
		const [family, tsRaw, op] = parts;
		const tsMinute = Number.parseInt(tsRaw, 10);
		if (!Number.isFinite(tsMinute)) continue;
		if (!KV_OP_SET.has(op)) continue;
		attempted++;
		try {
			await env.DB.prepare(
				`INSERT INTO kv_cache_metrics_minute (family, ts_minute, op, count)
				 VALUES (?1, ?2, ?3, ?4)
				 ON CONFLICT(family, ts_minute, op) DO UPDATE SET
				   count = count + excluded.count`,
			)
				.bind(family, tsMinute, op, count)
				.run();
		} catch (err) {
			console.warn(`[kv-metrics] flush row failed family=${family} ts=${tsMinute} op=${op}`, err);
		}
	}
	return attempted;
}

/**
 * Defer a flush onto `ctx.waitUntil`. Throttled at one flush per
 * `FLUSH_INTERVAL_MS` per isolate; the very first call after isolate
 * boot flushes immediately so single-request paths still surface
 * metrics. Always safe to call — no-op when nothing is pending or the
 * interval has not elapsed.
 */
export function scheduleMetricsFlush(env: Env, ctx: ExecutionContext): void {
	if (BUCKETS.size === 0) return;
	const now = Date.now();
	if (lastFlushAt !== 0 && now - lastFlushAt < FLUSH_INTERVAL_MS) return;
	lastFlushAt = now;
	const snap = swapSnapshot();
	ctx.waitUntil(
		flushSnapshot(env, snap).catch((err) => {
			console.warn("[kv-metrics] flush task crashed", err);
		}),
	);
}

/**
 * Test-only: reset both the in-isolate buckets and the throttle clock so
 * unit tests start from a clean state.
 */
export function __resetMetricsForTest(): void {
	BUCKETS.clear();
	lastFlushAt = 0;
}
