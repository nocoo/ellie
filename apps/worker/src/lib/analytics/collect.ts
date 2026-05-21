// Analytics page-view collector (P3).
//
// ────────────────────────────────────────────────────────────────
// SCOPE BOUNDARY — collector contract
// ────────────────────────────────────────────────────────────────
// This module ships the in-isolate aggregation + flush contract.
// P3 established the contract; P5 wires it end-to-end:
//
//   - Called from the internal ingest route
//     (`apps/worker/src/handlers/internal/analyticsIngest.ts`), which
//     invokes `recordPageView(sample)` and `scheduleFlush(env, ctx)`
//     from inside its handler after the trust-edge checks.
//   - Production binds the D1 sink in `apps/worker/src/index.ts` via
//     `setFlushSink(d1FlushSink)`. The default `FlushSink` in this
//     module is a no-op test/dev fallback that drains the bucket
//     without persisting — it is ONLY used when no production sink
//     has been installed (unit-test stubs, dev isolates that opt out).
//   - NOT reading any request-scoped trust signal. `recordPageView`
//     takes a fully-resolved `PageViewSample`. The ingest route owns
//     the trust edge (which header counts as the client IP, whether to
//     honor a forwarded user_id, etc.). The collector cannot be
//     tricked by a header it never sees.
//
// Mirrors the same in-isolate accumulator + waitUntil flush pattern as
// `cache/metrics.ts`. Both modules live for the lifetime of a Worker
// isolate; both swap their bucket BEFORE handing it off to a sink so
// that a sink failure loses at most one window's samples and never
// double-counts on retry.

import type { Env } from "../env";
import type { AggregateRow, BotClass, PageViewSample, PathKind } from "./types";

// ─── Bot classification ─────────────────────────────────────────

/**
 * Well-known search-engine crawler signatures. Lower-cased, matched
 * with `String.includes`. Kept narrow on purpose — the goal is to
 * separate "actual indexer traffic we want to surface to admins" from
 * the generic bot/spider noise band.
 *
 * The list is sorted by frequency observed in the source forum's
 * legacy access logs, which is dominated by the Chinese search
 * engines (Baidu > Sogou > 360) plus the global English ones.
 */
const SEARCH_BOT_TOKENS: readonly string[] = [
	"googlebot",
	"bingbot",
	"baiduspider",
	"yandexbot",
	"duckduckbot",
	"sogou",
	"360spider",
	"haosouspider",
	"yisouspider",
	"applebot",
	"petalbot",
];

/**
 * Generic bot/automation signatures. Anything matching one of these
 * but not a SEARCH_BOT_TOKENS entry falls into `bot_other` — admins
 * see a noise band without the collector pretending to know what
 * kind of bot it is.
 */
const GENERIC_BOT_TOKENS: readonly string[] = [
	"bot",
	"spider",
	"crawler",
	"slurp",
	"facebookexternalhit",
	"curl/",
	"wget/",
	"python-requests",
	"libwww",
	"httpclient",
	"go-http-client",
	"headlesschrome",
	"phantomjs",
];

/**
 * Classify a User-Agent into one of four coarse buckets. The collector
 * never stores raw UAs — only the bucket. Returns `unknown` for empty
 * / missing UA because many legitimate clients (mobile WebView, proxy)
 * strip the header; we don't want to silently count those as bots.
 *
 * Search-bot detection runs BEFORE generic-bot detection because every
 * search bot also matches `"bot"` and we want them in their own bucket.
 *
 * Pure function: no side effects, no env, no trust signals. The ingest
 * route may freely call this on whatever UA string it pulled from the
 * request before handing the resolved sample to `recordPageView`.
 */
export function parseBotClass(userAgent: string | null | undefined): BotClass {
	if (!userAgent) return "unknown";
	const ua = userAgent.toLowerCase();
	if (!ua.trim()) return "unknown";
	for (const tok of SEARCH_BOT_TOKENS) {
		if (ua.includes(tok)) return "bot_search";
	}
	for (const tok of GENERIC_BOT_TOKENS) {
		if (ua.includes(tok)) return "bot_other";
	}
	return "human";
}

// ─── In-isolate aggregation ─────────────────────────────────────

/**
 * Composite key separator. U+0001 (Start of Heading) cannot appear in
 * any field we use (dateLocal is `YYYY-MM-DD`, pathKind is a finite
 * enum, ids are integers, botClass is a finite enum), so split-on-sep
 * round-trips cleanly even though the field values are arbitrary.
 */
const KEY_SEP = "\x01";

interface BucketEntry {
	count: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

const BUCKETS: Map<string, BucketEntry> = new Map();

function bucketKey(s: PageViewSample): string {
	return `${s.dateLocal}${KEY_SEP}${s.pathKind}${KEY_SEP}${s.targetId}${KEY_SEP}${s.userId}${KEY_SEP}${s.botClass}`;
}

function parseBucketKey(
	key: string,
): Omit<AggregateRow, "count" | "firstSeenAt" | "lastSeenAt"> | null {
	const parts = key.split(KEY_SEP);
	if (parts.length !== 5) return null;
	const [dateLocal, pathKind, targetIdRaw, userIdRaw, botClass] = parts;
	const targetId = Number.parseInt(targetIdRaw, 10);
	const userId = Number.parseInt(userIdRaw, 10);
	if (!Number.isFinite(targetId) || !Number.isFinite(userId)) return null;
	return {
		dateLocal,
		pathKind: pathKind as PathKind,
		targetId,
		userId,
		botClass: botClass as BotClass,
	};
}

/**
 * Record one resolved page-view sample. The collector accumulates by
 * the canonical primary key of the `analytics_daily_targets` table:
 * `(dateLocal, pathKind, targetId, userId, botClass)`. For each key
 * the bucket tracks `count` (monotonic), `firstSeenAt` (min over
 * samples), and `lastSeenAt` (max over samples).
 *
 * Pure memory op — no IO, no env, no logging. Safe to call from any
 * handler. Trust-edge concerns (which header counts as the user_id,
 * which client_ip to honor, whether to throttle by session) MUST be
 * resolved by the caller before invoking this function.
 */
export function recordPageView(sample: PageViewSample): void {
	const key = bucketKey(sample);
	const entry = BUCKETS.get(key);
	if (entry) {
		entry.count += 1;
		if (sample.ts < entry.firstSeenAt) entry.firstSeenAt = sample.ts;
		if (sample.ts > entry.lastSeenAt) entry.lastSeenAt = sample.ts;
		return;
	}
	BUCKETS.set(key, {
		count: 1,
		firstSeenAt: sample.ts,
		lastSeenAt: sample.ts,
	});
}

/**
 * Snapshot + clear the live accumulator. Returns the drained rows as
 * `AggregateRow[]`. Public for tests; production callers go through
 * `scheduleFlush`.
 *
 * Swap semantics: the snapshot is detached BEFORE the caller does
 * anything with it, so a sink failure loses at most one window's
 * samples and never double-counts on retry.
 */
export function swapBuckets(): AggregateRow[] {
	if (BUCKETS.size === 0) return [];
	const rows: AggregateRow[] = [];
	for (const [key, entry] of BUCKETS.entries()) {
		const head = parseBucketKey(key);
		if (!head) continue;
		rows.push({
			...head,
			count: entry.count,
			firstSeenAt: entry.firstSeenAt,
			lastSeenAt: entry.lastSeenAt,
		});
	}
	BUCKETS.clear();
	return rows;
}

/**
 * Number of distinct aggregate keys currently held in the bucket.
 * Public for tests and (eventually) debug endpoints. Returns 0 when
 * the collector has drained or never observed a sample.
 */
export function pendingBucketSize(): number {
	return BUCKETS.size;
}

// ─── Flush contract ─────────────────────────────────────────────

/**
 * Sink contract handed a drained snapshot. The default implementation
 * is a no-op kept for unit-test stubs / dev isolates that opt out of
 * persistence. Production swaps it for the D1 UPSERT sink
 * (`flushSink-d1.ts`) via `setFlushSink(d1FlushSink)` in
 * `apps/worker/src/index.ts`. Tests inject their own sink via
 * `setFlushSink`.
 *
 * Sinks MUST NOT throw. Errors that bubble out of a sink are caught
 * inside `scheduleFlush` and logged but do not propagate to the
 * request hot path.
 */
export type FlushSink = (env: Env, rows: AggregateRow[]) => Promise<void>;

const NOOP_SINK: FlushSink = async () => {
	// Default fallback: drain without persisting. The production D1
	// sink (`flushSink-d1.ts`) is installed by `index.ts` via
	// `setFlushSink(d1FlushSink)`; this no-op remains the safe default
	// for unit-test stubs that have not opted into a sink.
};

let activeSink: FlushSink = NOOP_SINK;

/**
 * Install a flush sink. `apps/worker/src/index.ts` swaps in the D1
 * UPSERT sink at module load; tests use this entry point to assert
 * what was drained. Production code outside that one swap point MUST
 * NOT call this.
 */
export function setFlushSink(sink: FlushSink): void {
	activeSink = sink;
}

/**
 * Reset the flush sink to the default no-op. Public for tests so each
 * case starts from a clean slate; production never calls this.
 */
export function resetFlushSink(): void {
	activeSink = NOOP_SINK;
}

/** Flush at most once every 30 seconds per isolate. */
const FLUSH_INTERVAL_MS = 30_000;

/**
 * Timestamp of the last `scheduleFlush` that actually drained. 0 means
 * "no flush has ever been issued from this isolate". The very first
 * call after isolate boot always flushes immediately so low-traffic
 * paths still surface samples through the contract within one request.
 */
let lastFlushAt = 0;

/**
 * Defer a flush onto `ctx.waitUntil`. Throttled at one flush per
 * `FLUSH_INTERVAL_MS` per isolate; the very first call after isolate
 * boot flushes immediately. Always safe to call — no-op when the
 * bucket is empty or the throttle window has not elapsed.
 *
 * The drained snapshot is handed to the active `FlushSink`. Production
 * binds the D1 UPSERT sink in `apps/worker/src/index.ts`; with the
 * default no-op sink (unit-test stubs / dev opt-out), the snapshot is
 * simply discarded.
 */
export function scheduleFlush(env: Env, ctx: ExecutionContext): void {
	if (BUCKETS.size === 0) return;
	const now = Date.now();
	if (lastFlushAt !== 0 && now - lastFlushAt < FLUSH_INTERVAL_MS) return;
	lastFlushAt = now;
	const snap = swapBuckets();
	const sink = activeSink;
	ctx.waitUntil(
		sink(env, snap).catch((err) => {
			console.warn("[analytics] flush sink crashed", err);
		}),
	);
}

/**
 * Reset the throttle so the next `scheduleFlush` call will drain even
 * if `FLUSH_INTERVAL_MS` has not elapsed. Public for tests; production
 * never calls this.
 */
export function resetFlushThrottle(): void {
	lastFlushAt = 0;
}

// ─── Test-only internals ───────────────────────────────────────

/**
 * Internal handles for unit tests. Production code MUST import the
 * named exports above; this namespace is intentionally not part of the
 * collector's public surface and may change without notice.
 */
export const _internal = {
	parseBucketKey,
	bucketKey,
	NOOP_SINK,
	FLUSH_INTERVAL_MS,
};
