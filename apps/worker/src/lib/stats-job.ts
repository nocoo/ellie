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
// Reviewer guard rails (msg=d646977b, msg=92086575) baked in here:
//   - per-kind singleton:        single KV key `stats:recalc-job:<kind>`.
//   - state must survive 503:    each tick stakes a short lease under
//                                that key before running `advance`; a
//                                worker death between stake and finish
//                                leaves a stale lease that the next POST
//                                reclaims after `JOB_LEASE_SECONDS`.
//   - lease is NOT the running   `leaseUntil` only represents an
//     marker:                    in-flight `advance` window. Idle running
//                                jobs persist with `leaseUntil:null` so
//                                the next POST can advance immediately
//                                (this was wrong in the first cut and
//                                broke the "one POST = one batch" driver).
//   - schema/version pinned:     `payload.v = 1` so future migrations can
//                                detect older state.
//   - GET is read-only:          this file exposes `readJob`, never advances.
//   - `reset: true` opens fresh  a `done` / `failed` job. Running jobs are
//                                NEVER reset by a POST — we return
//                                `code:"running"` (→ 409) so the operator
//                                must wait or let the in-flight tick die.
//   - KV writes are not silent:  `writeJob` propagates errors. A dropped
//                                checkpoint would cause the next tick to
//                                replay the same cursor, so the caller
//                                surfaces the failure instead of
//                                pretending the write succeeded.
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
 *   - `leaseUntil` — unix ms; non-null ONLY while a single `advance`
 *                   call is executing. A concurrent POST that sees a
 *                   non-null lease past `now` returns `code:"locked"`
 *                   (→ 409). An idle running job between batches has
 *                   `leaseUntil: null`. A stranded lease (worker died
 *                   mid-`advance`) is reclaimable once `now` is past
 *                   the staked value.
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
 * mid-run.
 *
 * Reviewer pin (msg=92086575, A.1): writes MUST NOT be silently
 * swallowed — a successful D1 mutation paired with a dropped KV
 * checkpoint causes the UI to repeat the same cursor on the next tick.
 * Errors propagate; the caller in `tickJob` decides how to surface them.
 */
export async function writeJob(env: Env, payload: StatsJobPayload): Promise<void> {
	await env.KV.put(statsJobKey(payload.kind), JSON.stringify(payload), {
		expirationTtl: JOB_KV_TTL_SECONDS,
	});
}

/**
 * Helper for `initialize` implementations — bundles the boilerplate so
 * tickers can focus on cursor/total estimation.
 *
 * Reviewer pin (msg=92086575, A.1): an idle-running job MUST persist
 * with `leaseUntil: null`. The lease window only represents an
 * in-flight `advance` call; pre-stamping a 60s lease at initialization
 * was wrong — it locked out the very next POST and broke the
 * "one POST = one batch" UI driver. The framing in `tickJob` re-stamps
 * the lease just before invoking `advance` and clears it after.
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
		leaseUntil: null,
		error: null,
		params: args.params ?? {},
	};
}

// ---------------------------------------------------------------------------
// Framing: start-or-tick
// ---------------------------------------------------------------------------

/**
 * Outcome reported back to the HTTP handler. The route layer turns this
 * into `jsonNoStoreResponse(payload, ...)` on `ok`, a 409
 * `errorResponse("RUNNING_JOB_EXISTS"|"CONCURRENT_TICK", ...)` on
 * `running` / `locked`, and a 500/JSON-payload error response on `error`.
 *
 * The four codes have distinct meanings (msg=92086575):
 *   - `ok`        — normal initialize OR advance OR terminal-snapshot read.
 *   - `locked`    — another in-flight `advance` is holding the lease right
 *                   now; caller should retry shortly (409).
 *   - `running`   — operator tried `reset:true` while the job is still
 *                   running; we refuse rather than tear down a live
 *                   tick (409). `reset` is for `done` / `failed` only.
 *   - `error`     — `advance` or `writeJob` threw. Payload reflects the
 *                   failed state (status=failed, error=...).
 */
export type TickResult =
	| { code: "ok"; payload: StatsJobPayload; advanced: boolean }
	| { code: "locked"; payload: StatsJobPayload }
	| { code: "running"; payload: StatsJobPayload }
	| { code: "error"; payload: StatsJobPayload; error: string };

/**
 * POST entry point. Behaviour per `(current state, body.reset)`:
 *   - no payload                              → `initialize`, return ok.
 *   - status="done"/"failed", no reset        → return snapshot, no advance.
 *   - status="done"/"failed", reset:true      → `initialize`, return ok.
 *   - status="running", reset:true            → return `code:"running"`
 *                                               (refuse to tear down a
 *                                               live job; 409).
 *   - status="running", leaseUntil > now      → concurrent in-flight
 *                                               `advance`; return
 *                                               `code:"locked"` (409).
 *   - status="running", lease null/expired    → stake a fresh lease,
 *                                               run one `advance` batch,
 *                                               clear lease, persist.
 *
 * Lease semantics (msg=92086575, A.1): `leaseUntil` represents ONLY the
 * window in which a single `advance` is executing. It is staked
 * immediately before `advance` (and persisted so a truly concurrent
 * POST sees `locked`) and cleared after the call returns — whether
 * `advance` succeeded, failed, or pushed the job to `done`. An idle
 * running job between batches therefore has `leaseUntil: null` and the
 * next POST advances without waiting 60s. The 60s horizon only matters
 * when a previous tick was killed mid-call (503 / OOM) — the next POST
 * still finds the stale lease, sees it has passed `now`, and takes over.
 *
 * Errors:
 *   - Throws from `initialize` propagate to the caller (setup errors).
 *   - Throws from `advance` are caught here; payload is flipped to
 *     `failed` and `code:"error"` is returned.
 *   - Throws from `writeJob` (the lease stake, the final persist, or
 *     the failed-status persist) bubble up — a dropped checkpoint
 *     means the next tick would replay the same cursor, so we surface
 *     it instead of silently succeeding.
 *   - Throws from `finalize` are logged but do NOT roll the job back
 *     to `failed`; the data is correct, only a cache bump went wrong.
 */
export async function tickJob(
	env: Env,
	ticker: StatsJobTicker,
	body: Record<string, unknown>,
	now: number = Date.now(),
): Promise<TickResult> {
	const reset = body.reset === true;
	const current = await readJob(env, ticker.kind);

	// (1) No payload at all → first POST opens a fresh job.
	if (!current) {
		const initial = await ticker.initialize(env, body);
		await writeJob(env, initial);
		// initialize does not advance — it only commits the initial
		// payload so the UI sees status=running on the first card render.
		// The next POST starts the first batch.
		return { code: "ok", payload: initial, advanced: false };
	}

	// (2) Terminal states. reset:true reopens; otherwise return snapshot.
	if (current.status === "done" || current.status === "failed") {
		if (reset) {
			const initial = await ticker.initialize(env, body);
			await writeJob(env, initial);
			return { code: "ok", payload: initial, advanced: false };
		}
		return { code: "ok", payload: current, advanced: false };
	}

	// (3) Running + reset:true → refuse. We do not silently tear down a
	//     live job; the operator must wait for it to land (or explicitly
	//     wait for the in-flight tick to die and the lease to expire).
	if (reset) {
		return { code: "running", payload: current };
	}

	// (4) Concurrent in-flight advance — another POST is mid-tick and
	//     holds the lease. Return `locked` (route → 409). Note this is
	//     NOT "running job exists" — it's "another tick is executing
	//     right now"; the same POST will succeed once the holder
	//     finishes (advance) or the lease expires (crash takeover).
	if (current.leaseUntil !== null && current.leaseUntil > now) {
		return { code: "locked", payload: current };
	}

	// (5) Stake a fresh lease before running advance so a truly
	//     concurrent second POST sees `locked` rather than racing on
	//     the same batch. Persisting first matters: if the worker
	//     dies between stake and advance, the next POST sees a stale
	//     lease and can take over after `JOB_LEASE_SECONDS`.
	const reclaimed: StatsJobPayload = {
		...current,
		leaseUntil: now + JOB_LEASE_SECONDS * 1000,
		lastTickAt: now,
	};
	await writeJob(env, reclaimed);

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
		// If this write itself fails, surface the throw — the caller
		// will produce a 500 and the next tick will still see the old
		// (running, stale-lease) payload and can take over.
		await writeJob(env, failed);
		return { code: "error", payload: failed, error: failed.error ?? "unknown" };
	}

	// Framework — not the ticker — is responsible for clearing the
	// lease after advance. An idle running job between batches has
	// leaseUntil=null so the very next POST can advance immediately.
	const checkpointed: StatsJobPayload = {
		...next,
		leaseUntil: null,
	};
	await writeJob(env, checkpointed);

	if (checkpointed.status === "done" && ticker.finalize) {
		try {
			await ticker.finalize(env, checkpointed);
		} catch (err) {
			// Finalize failure shouldn't roll the job back to failed —
			// the data is correct, only the cache bump went wrong. Log
			// and let the caller see `done`.
			console.warn(`[stats-job] finalize failed kind=${checkpointed.kind}`, err);
		}
	}

	return { code: "ok", payload: checkpointed, advanced: true };
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
