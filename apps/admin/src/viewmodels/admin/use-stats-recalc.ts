// viewmodels/admin/use-stats-recalc.ts — Phase E of task #19.
// Drives ONE of the four recalc cards (forums / threads / users /
// post-forums) on /admin/statistics/recalc. Each card is independent:
// every kind owns its own hook instance, KV state on the worker side,
// and in-flight POST lock here.
//
// Reviewer constraints baked in (msg=8b855b38):
//   1. The card must show both `processed/total` (scan progress) and
//      `updated/lastBatchUpdated` (rows actually mutated). The page
//      reads `state.snapshot` directly and formats both rows — the
//      hook never collapses them into a single "已更新" string.
//   2. ONE in-flight POST per kind. `state.isPosting` is the lock; the
//      polling timer skips a tick whenever a POST is already running.
//      The 内容 button likewise refuses to fire while `isPosting`.
//   3. 409 `CONCURRENT_TICK` and 409 `RUNNING_JOB_EXISTS` are NOT errors.
//      We pull the embedded `details.payload` out of the body and keep
//      polling. The error banner only lights up for true failures
//      (network throw, 500 RECALC_FAILED, non-JSON body).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
	extractSnapshotFromError,
	isSnapshot,
	isSoftConflictCode,
	jobEndpoint,
	recalcEndpoint,
	type StatsJobKind,
	type StatsJobSnapshot,
	type WorkerErrorBody,
} from "@/viewmodels/admin/stats-recalc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatsRecalcState {
	/** Latest snapshot from the worker. `null` before the first read. */
	snapshot: StatsJobSnapshot | null;
	/** True while the initial GET is in flight. */
	loading: boolean;
	/** True while a POST (tick or reset) is in flight. */
	isPosting: boolean;
	/**
	 * Latest hard-failure message, or `null`. A 409 soft conflict
	 * (`CONCURRENT_TICK` / `RUNNING_JOB_EXISTS`) clears this — only a
	 * real failure (500, network, parse) lights the badge red.
	 */
	error: string | null;
}

export interface StatsRecalcActions {
	/** First POST → server `initialize`s the job. */
	start: () => Promise<void>;
	/** Subsequent POST → server runs one batch. */
	advance: () => Promise<void>;
	/** POST `{reset:true}` → re-open a terminal job. */
	reset: () => Promise<void>;
	/** Force a snapshot re-fetch without advancing. */
	refresh: () => Promise<void>;
}

export interface UseStatsRecalcReturn {
	state: StatsRecalcState;
	actions: StatsRecalcActions;
}

export interface UseStatsRecalcOptions {
	/** Kind this hook drives. Stable per card. */
	kind: StatsJobKind;
	/** Poll interval (ms) while the job is `running`. Default 1500. */
	pollIntervalMs?: number;
	/**
	 * When true (default), the polling timer auto-POSTs the next
	 * batch while `status==="running"`. Set to false for tests or for
	 * a "step manually" mode in the UI.
	 */
	autoAdvance?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse a fetch Response into either a snapshot or a structured error.
 *
 * Wire contract (E.1 fix per reviewer msg=5c975973):
 *   - 2xx body is the worker envelope `{data, meta}` from
 *     `jsonNoStoreResponse`. We unwrap `data` before validating:
 *       - `data === null`               → fresh kind, no job yet
 *                                          (GET before first POST)
 *       - `data` matches `isSnapshot`   → real progress
 *       - anything else on 2xx          → hard contract error
 *   - 4xx/5xx body is the FLAT error shape from `errorResponse`
 *     (NOT envelope-wrapped). 409 details.payload carries the snapshot
 *     for soft conflicts; 500 RECALC_FAILED carries the failed snapshot
 *     plus an error message.
 *
 * Branches:
 *   - 2xx + data:null                          → `{ kind:"empty" }`
 *   - 2xx + data:snapshot (kind matches)       → `{ kind:"snapshot", snapshot }`
 *   - 2xx + data:snapshot (cross-kind)         → `{ kind:"hard", message }`
 *     (a forums card MUST NOT render a users snapshot — guards against
 *     proxy / wiring mistakes that would silently show the wrong job)
 *   - 2xx without `data` field or wrong shape  → `{ kind:"hard", message }`
 *   - 409 CONCURRENT_TICK / RUNNING_JOB_EXISTS → `{ kind:"soft", snapshot? }`
 *   - any other non-2xx                        → `{ kind:"hard", message, snapshot? }`
 *   - body parse failure                       → `{ kind:"hard", message }`
 */
export type ParsedResponse =
	| { kind: "snapshot"; snapshot: StatsJobSnapshot }
	| { kind: "empty" }
	| { kind: "soft"; snapshot: StatsJobSnapshot | null }
	| { kind: "hard"; message: string; snapshot: StatsJobSnapshot | null };

export async function parseRecalcResponse(
	res: Response,
	expectedKind: StatsJobKind,
): Promise<ParsedResponse> {
	let body: unknown;
	try {
		body = await res.json();
	} catch {
		return {
			kind: "hard",
			message: `${res.status} ${res.statusText || "解析响应失败"}`,
			snapshot: null,
		};
	}

	if (res.ok) {
		// Worker 2xx envelope: `{data, meta}` from jsonNoStoreResponse.
		if (!body || typeof body !== "object" || !("data" in (body as object))) {
			return { kind: "hard", message: "返回数据格式无效", snapshot: null };
		}
		const data = (body as { data: unknown }).data;
		if (data === null) {
			// GET against a kind with no KV state yet — not an error.
			return { kind: "empty" };
		}
		if (!isSnapshot(data)) {
			return { kind: "hard", message: "返回数据格式无效", snapshot: null };
		}
		if (data.kind !== expectedKind) {
			// Hard contract bug: a kind="forums" card must never accept a
			// snapshot for another kind. Surface as a hard error so the
			// card lights up red and we notice the mis-wiring.
			return {
				kind: "hard",
				message: `kind 不匹配：期望 ${expectedKind}，收到 ${data.kind}`,
				snapshot: null,
			};
		}
		return { kind: "snapshot", snapshot: data };
	}

	// Non-OK. Flat error shape `{error:{code, details:{payload?}}}`.
	const embedded = extractSnapshotFromError(body);
	const embeddedSafe = embedded && embedded.kind === expectedKind ? embedded : null;
	const code = (body as WorkerErrorBody | undefined)?.error?.code ?? "";
	if (isSoftConflictCode(code)) {
		return { kind: "soft", snapshot: embeddedSafe };
	}
	const detailsErr = (body as WorkerErrorBody | undefined)?.error?.details?.error;
	const fallbackMsg = (body as WorkerErrorBody | undefined)?.error?.message;
	const message =
		(typeof detailsErr === "string" && detailsErr) ||
		(typeof fallbackMsg === "string" && fallbackMsg) ||
		code ||
		`HTTP ${res.status}`;
	return { kind: "hard", message, snapshot: embeddedSafe };
}

/**
 * Whether the polling timer should drive an auto-advance POST right
 * now. Centralised so the test can assert the rule without spinning
 * up timers.
 */
export function shouldAutoAdvance(
	snapshot: StatsJobSnapshot | null,
	isPosting: boolean,
	autoAdvance: boolean,
): boolean {
	if (!autoAdvance) return false;
	if (isPosting) return false;
	if (!snapshot) return false;
	return snapshot.status === "running";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useStatsRecalc({
	kind,
	pollIntervalMs = 1500,
	autoAdvance = true,
}: UseStatsRecalcOptions): UseStatsRecalcReturn {
	const [snapshot, setSnapshot] = useState<StatsJobSnapshot | null>(null);
	const [loading, setLoading] = useState(true);
	const [isPosting, setIsPosting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// `isPostingRef` mirrors `isPosting` for the polling timer — React
	// state lags one render behind a synchronous setIsPosting(true)
	// call, but the timer reads the ref each tick so it never doubles
	// up with an in-flight POST that started this same JS task.
	const isPostingRef = useRef(false);
	const snapshotRef = useRef<StatsJobSnapshot | null>(null);
	const cancelledRef = useRef(false);

	// Keep the refs in sync.
	useEffect(() => {
		isPostingRef.current = isPosting;
	}, [isPosting]);
	useEffect(() => {
		snapshotRef.current = snapshot;
	}, [snapshot]);

	// -------------------------------------------------------------------------
	// Internal: apply a parsed response (no posting / loading flag changes).
	// -------------------------------------------------------------------------

	const applyParsed = useCallback((parsed: ParsedResponse) => {
		if (cancelledRef.current) return;
		switch (parsed.kind) {
			case "snapshot":
				setSnapshot(parsed.snapshot);
				setError(null);
				return;
			case "empty":
				// Kind has no KV state yet (fresh GET before first POST).
				// Clear any prior error and keep snapshot null so the card
				// shows the 「尚未开始」 placeholder.
				setSnapshot(null);
				setError(null);
				return;
			case "soft":
				if (parsed.snapshot) setSnapshot(parsed.snapshot);
				setError(null);
				return;
			case "hard":
				if (parsed.snapshot) setSnapshot(parsed.snapshot);
				setError(parsed.message);
				return;
		}
	}, []);

	// -------------------------------------------------------------------------
	// Internal: GET snapshot (no advance).
	// -------------------------------------------------------------------------

	const refresh = useCallback(async () => {
		try {
			const res = await fetch(jobEndpoint(kind), { method: "GET" });
			applyParsed(await parseRecalcResponse(res, kind));
		} catch (err) {
			if (cancelledRef.current) return;
			setError(err instanceof Error ? err.message : "网络错误");
		} finally {
			if (!cancelledRef.current) setLoading(false);
		}
	}, [kind, applyParsed]);

	// -------------------------------------------------------------------------
	// Internal: POST (initialize, advance, or reset).
	// -------------------------------------------------------------------------

	const postTick = useCallback(
		async (body?: Record<string, unknown>) => {
			if (isPostingRef.current) return;
			isPostingRef.current = true;
			setIsPosting(true);
			try {
				const res = await fetch(recalcEndpoint(kind), {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: body ? JSON.stringify(body) : undefined,
				});
				applyParsed(await parseRecalcResponse(res, kind));
			} catch (err) {
				if (cancelledRef.current) return;
				setError(err instanceof Error ? err.message : "网络错误");
			} finally {
				isPostingRef.current = false;
				if (!cancelledRef.current) setIsPosting(false);
			}
		},
		[kind, applyParsed],
	);

	// -------------------------------------------------------------------------
	// Public actions
	// -------------------------------------------------------------------------

	const start = useCallback(() => postTick(), [postTick]);
	const advance = useCallback(() => postTick(), [postTick]);
	const reset = useCallback(() => postTick({ reset: true }), [postTick]);

	// -------------------------------------------------------------------------
	// Lifecycle: initial GET on mount.
	// -------------------------------------------------------------------------

	useEffect(() => {
		cancelledRef.current = false;
		refresh();
		return () => {
			cancelledRef.current = true;
		};
	}, [refresh]);

	// -------------------------------------------------------------------------
	// Lifecycle: polling loop. Drives auto-advance while running and
	// keeps the snapshot fresh otherwise (so a `done`/`failed` finalize
	// reaches the UI without a manual refresh).
	// -------------------------------------------------------------------------

	useEffect(() => {
		if (snapshot === null) return; // Wait for the initial GET.
		if (snapshot.status !== "running") return; // Terminal: stop polling.
		const id = setInterval(() => {
			const snap = snapshotRef.current;
			if (!snap) return;
			if (snap.status !== "running") return;
			if (shouldAutoAdvance(snap, isPostingRef.current, autoAdvance)) {
				void postTick();
			} else if (!isPostingRef.current) {
				void refresh();
			}
		}, pollIntervalMs);
		return () => clearInterval(id);
	}, [snapshot, pollIntervalMs, autoAdvance, postTick, refresh]);

	return {
		state: { snapshot, loading, isPosting, error },
		actions: { start, advance, reset, refresh },
	};
}
