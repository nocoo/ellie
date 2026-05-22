// Statistics recalc job state machine (KV-backed, per-kind singleton).
//
// Task #1: previous /api/admin/statistics/recalc-* endpoints tried to do all
// work in a single Worker request, which routinely timed out (503) once
// `threads` / `posts` / `users` rows reached six figures. The new model splits
// every recalc into batches of `DEFAULT_BATCH_SIZE` (= 1000) rows. The admin
// UI drives progress by POSTing repeatedly — each POST advances exactly one
// batch, returning the latest snapshot. A separate GET surfaces the current
// snapshot without advancing.
//
// Reviewer guard rails (msg=d646977b) baked in here:
//   - per-kind singleton:        single KV key `stats:recalc-job:<kind>`.
//   - state must survive 503:    each tick checkpoints under that key with a
//                                lease; a stranded `running` job past
//                                `leaseUntil` is reclaimable on the next POST.
//   - schema/version pinned:     `payload.v = 1` so future migrations can
//                                detect older state.
//   - GET is read-only:          this file exposes `readJob`, never advances.
//   - `reset: true` body opens   a fresh job over a `done` / `failed` one.
//
// Per-kind tickers live in `handlers/admin/statistics.ts`. They build the
// initial payload (total estimate + cursor=0 + params from the request) and
// implement `runOneBatch(prev) -> next` — this file owns the framing
// (start-or-tick, lease/mutex, reset gate, error capture, KV CRUD).

import type { Env } from "./env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Per-kind singleton KV key. */
export function statsJobKey(kind: StatsJobKind): string {
	return `stats:recalc-job:${kind}`;
}

/** 24h — keeps the post-run snapshot around for the UI card. */
export const JOB_KV_TTL_SECONDS = 24 * 60 * 60;

/** Default rows per batch; callers may override per-kind via `params.batchSize`. */
export const DEFAULT_BATCH_SIZE = 1000;

/**
 * Lease horizon for an active tick — a stranded job whose `leaseUntil` has
 * passed is reclaimable by the next POST. 60s comfortably covers a single
 * D1 batch even on the slowest module (recalcThreads) without leaving a
 * crash-killed job blocking the kind for 24h.
 */
export const JOB_LEASE_SECONDS = 60;

/** Schema version embedded in every payload; bump on shape changes. */
export const STATS_JOB_PAYLOAD_VERSION = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatsJobKind = "forums" | "threads" | "users" | "post-forums";
export const STATS_JOB_KINDS: readonly StatsJobKind[] = [
	"forums",
	"threads",
	"users",
	"post-forums",
];

export type StatsJobStatus = "running" | "done" | "failed";

/**
 * KV-persisted payload. `cursor` and `params` are opaque to this layer —
 * each per-kind ticker owns the shape, this file just stores/forwards them.
 *
 * Field meanings:
 *   - `processed` — rows the cursor has advanced past (scan progress).
 *   - `total`     — best-effort denominator for the % bar; may be null when
 *                   a kind can't cheaply estimate it (the UI then shows
 *                   "processed / —" instead of a percent).
 *   - `updated`   — rows actually mutated (recalc-post-forums only mutates
 *                   mismatched rows, so this diverges from `processed`).
 *   - `lastBatchUpdated` — rows mutated in the most recent tick. Useful for
 *                   the card's per-batch readout.
 *   - `leaseUntil` — unix ms; while running and within lease, duplicate
 *                   POSTs return the snapshot without advancing.
 */
export interface StatsJobPayload {
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

/**
 * Per-kind ticker contract. The framing in `tickJob` calls these in order:
 *   1. `initialize` — first POST when no payload exists (or `reset:true`).
 *      Returns the initial payload (cursor 0, processed 0, total estimate).
 *      Receives the parsed request body so kind-specific params (e.g.
 *      recalc-threads `forumId`, recalc-users `ids`) land in `params`.
 *   2. `advance`   — every subsequent POST. Mutates D1 for one batch and
 *      returns the next payload. MUST set status to `done` or update
 *      cursor/processed; framing handles `failed` on throw.
 *   3. `finalize`  — invoked once when status transitions to `done`.
 *      Hosts cache invalidation; runs OUTSIDE the lease so a slow KV/cache
 *      bump can't strand the lease.
 *
 * `processed` / `updated` are monotonic non-decreasing — framing trusts
 * the ticker to honour that.
 */
export interface StatsJobTicker {
	kind: StatsJobKind;
	initialize: (env: Env, body: Record<string, unknown>) => Promise<StatsJobPayload>;
	advance: (env: Env, prev: StatsJobPayload) => Promise<StatsJobPayload>;
	finalize?: (env: Env, payload: StatsJobPayload) => Promise<void>;
}

// ---------------------------------------------------------------------------
// KV CRUD
// ---------------------------------------------------------------------------

/**
 * Read the current snapshot for a kind. Returns `null` when KV has nothing
 * (no job ever started, or 24h TTL expired). Wrong-shape payloads (e.g. a
 * future version we don't understand) are treated as null so a corrupt
 * write can't block all future jobs — the next POST will overwrite cleanly.
 */
export async function readJob(env: Env, kind: StatsJobKind): Promise<StatsJobPayload | null> {
	let raw: unknown;
	try {
		raw = await env.KV.get(statsJobKey(kind), "json");
	} catch (err) {
		console.warn(`[stats-job] read failed kind=${kind}`, err);
		return null;
	}
	if (!isJobPayload(raw)) return null;
	if (raw.kind !== kind) return null; // sanity: never trust a cross-kind read
	if (raw.v !== STATS_JOB_PAYLOAD_VERSION) return null;
	return raw;
}

/**
 * Persist a snapshot under the per-kind key with a 24h TTL. We renew the
 * TTL on every write so an active job near the 24h mark doesn't expire
 * mid-run. Wrap in try/catch so KV hiccups never bubble into an HTTP error
 * mid-tick — the worst case is a single missed update.
 */
export async function writeJob(env: Env, payload: StatsJobPayload): Promise<void> {
	try {
		await env.KV.put(statsJobKey(payload.kind), JSON.stringify(payload), {
			expirationTtl: JOB_KV_TTL_SECONDS,
		});
	} catch (err) {
		console.warn(`[stats-job] write failed kind=${payload.kind}`, err);
	}
}

/**
 * Helper for `initialize` implementations — bundles the boilerplate so
 * tickers can focus on cursor/total estimation.
 */
export function makeInitialPayload(args: {
	kind: StatsJobKind;
	total: number | null;
	batchSize?: number;
	params?: Record<string, unknown>;
	now?: number;
}): StatsJobPayload {
	const now = args.now ?? Date.now();
	const batchSize = args.batchSize ?? DEFAULT_BATCH_SIZE;
	return {
		v: STATS_JOB_PAYLOAD_VERSION,
		kind: args.kind,
		status: "running",
		cursor: 0,
		processed: 0,
		total: args.total,
		updated: 0,
		lastBatchUpdated: 0,
		batchSize,
		startedAt: now,
		lastTickAt: now,
		finishedAt: null,
		leaseUntil: now + JOB_LEASE_SECONDS * 1000,
		error: null,
		params: args.params ?? {},
	};
}

// ---------------------------------------------------------------------------
// Framing: start-or-tick
// ---------------------------------------------------------------------------

/**
 * Outcome reported back to the HTTP handler. The route layer turns this into
 * a `jsonNoStoreResponse({ data: payload }, ...)` (or an errorResponse on
 * `code === "LOCKED"`).
 */
export type TickResult =
	| { code: "ok"; payload: StatsJobPayload; advanced: boolean }
	| { code: "locked"; payload: StatsJobPayload }
	| { code: "error"; payload: StatsJobPayload; error: string };

/**
 * POST entry point. Behaviour per `(current state, body.reset)`:
 *   - no payload OR `reset:true`             → `initialize` then return.
 *   - status="running" AND lease active       → return current snapshot
 *                                               with `code:"locked"` so the
 *                                               UI shows the existing job
 *                                               and the route emits 409.
 *   - status="running" AND lease expired      → reclaim: refresh lease,
 *                                               advance one batch.
 *   - status="done"/"failed" without reset    → return snapshot, no advance.
 *
 * Throws from `initialize` propagate to the caller (these are
 * setup-time errors, not job errors). Throws from `advance` are caught
 * here, the payload is flipped to `failed`, and `code:"error"` is
 * returned so the UI surfaces the message.
 */
export async function tickJob(
	env: Env,
	ticker: StatsJobTicker,
	body: Record<string, unknown>,
	now: number = Date.now(),
): Promise<TickResult> {
	const reset = body.reset === true;
	const current = await readJob(env, ticker.kind);

	// (1) New job (no payload, or operator asked to reset).
	if (!current || reset) {
		const initial = await ticker.initialize(env, body);
		await writeJob(env, initial);
		// First POST does NOT advance — it only stakes the lease and
		// commits the initial payload. The UI then either polls (GET) or
		// re-POSTs to start advancing. This keeps initialize cheap and
		// guarantees the first card render shows status=running before
		// the first batch runs.
		return { code: "ok", payload: initial, advanced: false };
	}

	// (2) Already finished (done or failed) — do nothing without reset.
	if (current.status === "done" || current.status === "failed") {
		return { code: "ok", payload: current, advanced: false };
	}

	// (3) Active lease — duplicate POST guard. Returns `locked` so the
	//     route layer emits 409 and the UI can fall back to GET polling.
	if (current.leaseUntil !== null && current.leaseUntil > now) {
		return { code: "locked", payload: current };
	}

	// (4) Lease expired OR null — reclaim and advance one batch.
	const reclaimed: StatsJobPayload = {
		...current,
		leaseUntil: now + JOB_LEASE_SECONDS * 1000,
		lastTickAt: now,
	};
	let next: StatsJobPayload;
	try {
		next = await ticker.advance(env, reclaimed);
	} catch (err) {
		const failed: StatsJobPayload = {
			...reclaimed,
			status: "failed",
			error: errMessage(err),
			leaseUntil: null,
			finishedAt: now,
			lastTickAt: now,
		};
		await writeJob(env, failed);
		return { code: "error", payload: failed, error: failed.error ?? "unknown" };
	}

	// Persist before running finalize so the UI sees `done` as soon as
	// the final batch lands, even if cache invalidation hiccups.
	await writeJob(env, next);

	if (next.status === "done" && ticker.finalize) {
		try {
			await ticker.finalize(env, next);
		} catch (err) {
			// Finalize failure shouldn't roll the job back to failed —
			// the data is correct, only the cache bump went wrong. Log
			// and let the caller see `done`.
			console.warn(`[stats-job] finalize failed kind=${next.kind}`, err);
		}
	}

	return { code: "ok", payload: next, advanced: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "string") return err;
	try {
		return JSON.stringify(err);
	} catch {
		return "unknown";
	}
}

/**
 * Narrow `unknown` from `KV.get(..., "json")` to `StatsJobPayload` by
 * structural shape. Conservative — anything not exactly matching the v1
 * shape is rejected and treated as "no payload" by `readJob`.
 */
function isJobPayload(value: unknown): value is StatsJobPayload {
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
		(v.error === null || typeof v.error === "string") &&
		typeof v.params === "object" &&
		v.params !== null
	);
}

/** Test/maintenance utility — explicitly clear the per-kind snapshot. */
export async function deleteJob(env: Env, kind: StatsJobKind): Promise<void> {
	try {
		await env.KV.delete(statsJobKey(kind));
	} catch (err) {
		console.warn(`[stats-job] delete failed kind=${kind}`, err);
	}
}
