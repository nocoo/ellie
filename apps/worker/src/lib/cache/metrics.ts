// In-isolate KV cache metrics accumulator.
//
// Scope: business cache families only (forum tree/summary/meta, thread
// list page1, user mini, settings, public stats). Short-lived auth /
// rate-limit / online-presence / activity-throttle families are NOT
// instrumented — they're high-volume and write-only enough that
// counters would dominate D1 load without changing operator decisions.
//
// Lifecycle:
//   - `recordHit / recordMiss / recordError` bump counters in an
//     in-isolate Map keyed by `(family, ts_minute)`. Pure memory ops,
//     no IO.
//   - `scheduleMetricsFlush(ctx)` is called from the request hot path
//     (typically right after a `cacheGetOrSet` invocation). It defers
//     the actual D1 write through `ctx.waitUntil` so the response is
//     never blocked. A `flushedRecently` guard prevents flushing more
//     than once per `FLUSH_INTERVAL_MS` per isolate.
//   - The flush itself does a SWAP (lift current snapshot, replace
//     with empty Map) BEFORE writing to D1. This means a write failure
//     loses at most one window's worth of counters and never causes
//     double-counting on retry — the snapshot is already detached from
//     the live accumulator when the UPSERT runs.
//
// D1 contract:
//   - Table `kv_cache_metrics_minute(family, ts_minute, hits, misses, errors)`
//     created in migration 0035. Single statement per row uses
//     `INSERT ... ON CONFLICT(family, ts_minute) DO UPDATE` so concurrent
//     isolates merge cleanly into the same minute bucket.
//   - All errors are caught and `console.warn`'d. Metrics are best-effort.

import type { Env } from "../env";

interface Bucket {
	hits: number;
	misses: number;
	errors: number;
}

const BUCKETS: Map<string, Bucket> = new Map();

/** Flush at most once every 30 seconds per isolate. */
const FLUSH_INTERVAL_MS = 30_000;
/**
 * Timestamp of the last flush (or first observation, when nothing has
 * flushed yet). Initialized to 0; set on the first `scheduleMetricsFlush`
 * call so we never flush immediately on isolate startup — that would
 * waste a D1 round-trip on a single counter and complicate unit tests
 * that do not expect any DB activity from a pure cache-hit path.
 */
let lastFlushAt = 0;

function bucketKey(family: string, tsMinute: number): string {
	return `${family}:${tsMinute}`;
}

function currentMinute(now = Date.now()): number {
	return Math.floor(now / 60_000);
}

function bump(family: string, field: keyof Bucket): void {
	const ts = currentMinute();
	const key = bucketKey(family, ts);
	let b = BUCKETS.get(key);
	if (!b) {
		b = { hits: 0, misses: 0, errors: 0 };
		BUCKETS.set(key, b);
	}
	b[field] += 1;
}

export function recordHit(family: string): void {
	bump(family, "hits");
}

export function recordMiss(family: string): void {
	bump(family, "misses");
}

export function recordError(family: string): void {
	bump(family, "errors");
}

/**
 * Snapshot the current in-isolate buckets and clear the live accumulator.
 * Public for tests; production callers should use `scheduleMetricsFlush`.
 */
export function swapSnapshot(): Map<string, Bucket> {
	if (BUCKETS.size === 0) return new Map();
	const snap = new Map(BUCKETS);
	BUCKETS.clear();
	return snap;
}

/**
 * Persist a snapshot to D1. Returns the number of rows attempted.
 * Errors are logged and swallowed — metrics writes MUST NOT throw.
 */
export async function flushSnapshot(env: Env, snap: Map<string, Bucket>): Promise<number> {
	if (snap.size === 0) return 0;
	let attempted = 0;
	for (const [key, b] of snap.entries()) {
		// key is `family:tsMinute`; rsplit because family may contain ':'.
		const idx = key.lastIndexOf(":");
		if (idx <= 0) continue;
		const family = key.slice(0, idx);
		const tsMinute = Number.parseInt(key.slice(idx + 1), 10);
		if (!Number.isFinite(tsMinute)) continue;
		attempted++;
		try {
			await env.DB.prepare(
				`INSERT INTO kv_cache_metrics_minute (family, ts_minute, hits, misses, errors)
				 VALUES (?1, ?2, ?3, ?4, ?5)
				 ON CONFLICT(family, ts_minute) DO UPDATE SET
				   hits = hits + excluded.hits,
				   misses = misses + excluded.misses,
				   errors = errors + excluded.errors`,
			)
				.bind(family, tsMinute, b.hits, b.misses, b.errors)
				.run();
		} catch (err) {
			console.warn(`[kv-metrics] flush row failed family=${family} ts=${tsMinute}`, err);
		}
	}
	return attempted;
}

/**
 * Defer a flush onto `ctx.waitUntil`. Throttled so we don't flush on
 * every cache call: at most one flush per isolate per FLUSH_INTERVAL_MS.
 * Always safe to call — no-op when nothing is pending or interval not
 * elapsed.
 */
export function scheduleMetricsFlush(env: Env, ctx: ExecutionContext): void {
	if (BUCKETS.size === 0) return;
	const now = Date.now();
	// First-call guard: arm the throttle clock without flushing. The very
	// first hit/miss in an isolate just records itself; a flush only runs
	// once at least one full FLUSH_INTERVAL_MS has elapsed AND there is
	// still pending data. This keeps simple cache-hit unit tests free of
	// surprise D1 calls and keeps real workloads cheap (at most one
	// UPSERT per family per 30s per isolate).
	if (lastFlushAt === 0) {
		lastFlushAt = now;
		return;
	}
	if (now - lastFlushAt < FLUSH_INTERVAL_MS) return;
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
