// In-isolate KV cache op-metrics accumulator (B.1).
//
// Scope: enrolled business caches and version I/O, with separate sources
// for administration, D1 observations, footprint gauges and view events.
// Auth / rate-limit / presence / activity state is not counted as business
// cache traffic. These observations do not represent all platform I/O.
//
// Op model:
//   - Every read attempt records `read`. A completed lookup also records
//     exactly one of `hit` or `miss`, so `read = hit + miss` for a window.
//   - `error` is a separate failure counter. KV.get throws still fall
//     through to `miss`, so `error` overlaps miss and must not be added
//     into `read = hit + miss + error`.
//   - Every successful write-back records `write`. KV.put failures
//     record `error` / `write-error`.
//   - `bumpGen` invalidations record `bump` for the affected business
//     family. Single-key deletes record `delete`.
//   - Occupancy gauges (`observed-keys` / `observed-bytes`) use per-minute
//     MAX in the isolate and on flush. They are never summed across isolates
//     and never backfilled.
//
// Lifecycle:
//   - `recordKvOp(family, op)` bumps in an in-isolate Map keyed by
//     `(family, ts_minute, op)`. Pure memory ops, no IO.
//   - `scheduleMetricsFlush(env, ctx)` is called from request hot paths
//     (`cacheGetOrSet`, user-cache batch loader, settings/stats
//     handlers). It defers the actual D1 write through `ctx.waitUntil`
//     so the response is never blocked. A `flushedRecently` guard
//     prevents flushing more than once per `FLUSH_INTERVAL_MS` per
//     isolate, with no first-observation or per-fill writes. A later request
//     triggers the flush after at least 60 seconds; cold isolates may lose samples.
//   - The flush itself does a SWAP (lift current snapshot, replace
//     with empty Map) BEFORE writing to D1. A write failure loses at
//     most one window's worth of counters and never causes
//     double-counting on retry — the snapshot is detached from the
//     live accumulator when the UPSERT runs.
//
// D1 contract:
//   - Table `kv_cache_metrics_minute(family, ts_minute, op, count)`
//     created in migration 0035. Bounded multi-row statements use
//     `INSERT ... ON CONFLICT(family, ts_minute, op) DO UPDATE` so
//     concurrent isolates merge counters and take gauge peaks.
//   - All errors are caught and `console.warn`'d. Metrics are best-effort.

import type { Env } from "../env";

/**
 * Whitelisted op dimensions. Kept narrow on purpose so the admin UI
 * series schema stays predictable and the D1 table doesn't grow
 * one row per ad-hoc verb.
 */
export type KvOp =
	| "read"
	| "hit"
	| "miss"
	| "write"
	| "bump"
	| "delete"
	| "error"
	| "load"
	| "kv-get"
	| "kv-put"
	| "kv-delete"
	| "load-error"
	| "write-error"
	| "invalidate-error"
	| "view-event"
	| "view-written"
	| "view-dropped"
	| "d1-query"
	| "d1-rows-read"
	| "d1-rows-written"
	| "d1-duration-ms"
	| "observed-keys"
	| "observed-bytes"
	| "observed-expired"
	| "observed-current";

const KV_OPS: readonly KvOp[] = [
	"read",
	"hit",
	"miss",
	"write",
	"bump",
	"delete",
	"error",
	"load",
	"kv-get",
	"kv-put",
	"kv-delete",
	"load-error",
	"write-error",
	"invalidate-error",
	"view-event",
	"view-written",
	"view-dropped",
	"d1-query",
	"d1-rows-read",
	"d1-rows-written",
	"d1-duration-ms",
	"observed-keys",
	"observed-bytes",
	"observed-expired",
	"observed-current",
];
const GAUGE_OPS: ReadonlySet<string> = new Set([
	"observed-keys",
	"observed-bytes",
	"observed-expired",
	"observed-current",
]);
const KV_OP_SET: ReadonlySet<string> = new Set<string>(KV_OPS);

const BUCKETS: Map<string, number> = new Map();

/** No first-request flush or per-fill flush: at most one window per minute/isolate. */
const FLUSH_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 512;
/** Flush eligibility is tracked from the first observation; no timer is kept alive. */
let lastFlushAt: number | null = null;
let firstObservedAt: number | null = null;

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
export function recordKvOp(family: string, op: KvOp, amount = 1): void {
	if (!KV_OP_SET.has(op) || !Number.isFinite(amount) || amount < 0) return;
	if (GAUGE_OPS.has(op)) {
		recordGauge(family, op, amount);
		return;
	}
	firstObservedAt ??= Date.now();
	const ts = currentMinute();
	const key = bucketKey(family, ts, op);
	if (!BUCKETS.has(key) && BUCKETS.size >= MAX_BUCKETS) return;
	BUCKETS.set(key, (BUCKETS.get(key) ?? 0) + amount);
}

/** Peak observation for occupancy gauges. Never sums across isolates. */
export function recordGauge(family: string, op: KvOp, amount: number, at = Date.now()): void {
	if (!GAUGE_OPS.has(op) || !Number.isFinite(amount) || amount < 0) return;
	firstObservedAt ??= at;
	const ts = currentMinute(at);
	const key = bucketKey(family, ts, op);
	if (!BUCKETS.has(key) && BUCKETS.size >= MAX_BUCKETS) return;
	BUCKETS.set(key, Math.max(BUCKETS.get(key) ?? 0, amount));
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
	const rows: [string, number, string, number][] = [];
	for (const [key, count] of snap) {
		const parts = key.split(KEY_SEP);
		if (parts.length !== 3) continue;
		const [family, tsRaw, op] = parts;
		const minute = Number(tsRaw);
		if (!Number.isSafeInteger(minute) || !KV_OP_SET.has(op) || !Number.isFinite(count) || count < 0)
			continue;
		rows.push([family, minute, op, count]);
	}
	const counters = rows.filter((row) => !GAUGE_OPS.has(row[2]));
	const gauges = rows.filter((row) => GAUGE_OPS.has(row[2]));
	// Four bindings per row: one statement handles at most 25 rows under
	// D1's 100-binding limit. Row writes are still measured as row writes.
	await writeMetricBatches(env, counters, "count = count + excluded.count");
	await writeMetricBatches(env, gauges, "count = MAX(count, excluded.count)");
	return rows.length;
}

async function writeMetricBatches(
	env: Env,
	rows: [string, number, string, number][],
	conflict: string,
): Promise<void> {
	for (let start = 0; start < rows.length; start += 25) {
		const batch = rows.slice(start, start + 25);
		try {
			const result =
				await env.DB.prepare(`INSERT INTO kv_cache_metrics_minute (family, ts_minute, op, count)
    VALUES ${batch.map(() => "(?, ?, ?, ?)").join(",")}
    ON CONFLICT(family, ts_minute, op) DO UPDATE SET ${conflict}`)
					.bind(...batch.flat())
					.run();
			if (!result.success) throw new Error("Metrics write was not confirmed");
		} catch {
			console.warn("[kv-metrics] metrics batch dropped", { rows: batch.length });
		}
	}
}

/** Later requests flush at most once per minute/isolate, with up to 512 metric rows. */
export function scheduleMetricsFlush(env: Env, ctx: ExecutionContext): void {
	if (BUCKETS.size === 0) return;
	const now = Date.now();
	if (firstObservedAt === null || now - (lastFlushAt ?? firstObservedAt) < FLUSH_INTERVAL_MS)
		return;
	lastFlushAt = now;
	const snap = swapSnapshot();
	ctx.waitUntil(
		flushSnapshot(env, snap).catch((err) => {
			console.warn("[kv-metrics] flush task crashed", err);
		}),
	);
}

/** Compatibility name; explicit operations obey the same 60-second budget. */
export function flushPendingNow(env: Env, ctx: ExecutionContext): void {
	scheduleMetricsFlush(env, ctx);
}

/**
 * Test-only: reset both the in-isolate buckets and the throttle clock so
 * unit tests start from a clean state.
 */
export function __resetMetricsForTest(): void {
	BUCKETS.clear();
	lastFlushAt = null;
	firstObservedAt = null;
}
