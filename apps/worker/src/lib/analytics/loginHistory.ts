// Login history persistence helpers (P4).
//
// ────────────────────────────────────────────────────────────────
// SCOPE BOUNDARY — auth attempt audit log
// ────────────────────────────────────────────────────────────────
// This module persists one row per **observable** auth attempt that
// `apps/worker/src/handlers/auth.ts` reaches AFTER trust-edge resolution.
// "Observable" means the request got far enough that we have both a
// usable client IP (via `extractTrustedClientIp`) and a candidate
// username branch (via JSON body parse), regardless of whether the
// attempt then succeeded or fell into a documented failure branch.
//
// Branches that DO write:
//   - login.success                              ok=1, error_code=""
//   - login.LOCKED_OUT_IP                        ok=0, error_code="LOCKED_OUT_IP"
//   - login.RATE_LIMITED_IP                      ok=0, error_code="RATE_LIMITED_IP"
//   - login.INVALID_CREDENTIALS (user not found OR password mismatch)
//                                                ok=0, error_code="INVALID_CREDENTIALS"
//   - login.USER_BANNED                          ok=0, error_code="USER_BANNED"
//   - register.success                           ok=1, error_code=""
//   - register.REGISTRATION_DISABLED             ok=0, error_code="REGISTRATION_DISABLED"
//   - register.USERNAME_BANNED                   ok=0, error_code="USERNAME_BANNED"
//   - register.RATE_LIMITED                      ok=0, error_code="RATE_LIMITED"
//   - register.EMAIL_ALREADY_IN_USE              ok=0, error_code="EMAIL_ALREADY_IN_USE"
//   - register.USERNAME_TAKEN                    ok=0, error_code="USERNAME_TAKEN"
//
// Branches that do NOT write (and why):
//   - body validation (INVALID_USERNAME / INVALID_PASSWORD /
//     INVALID_EMAIL / INVALID_BODY): the username slot can't be trusted
//     yet — instrumenting these would pollute the audit trail with
//     reflected-injection noise.
//   - missing client IP (INVALID_REQUEST when extractTrustedClientIp
//     returns null): if we don't have a usable IP the audit row loses
//     half its analytic value and is also a sign the request hit a
//     trust-edge problem worth surfacing separately.
//   - INTERNAL_ERROR catches: the throw path could indicate state we
//     don't want to persist; the worker already reports these via the
//     error middleware.
//
// ────────────────────────────────────────────────────────────────
// Responsibility split (reviewer pin msg=17dd0379)
// ────────────────────────────────────────────────────────────────
//   - `insertLoginHistory(env, row)` does ONE thing: prepares the row
//     and runs the D1 INSERT. It MAY throw on D1 failure — callers in
//     test code can opt-in to seeing the error.
//   - `scheduleLoginHistory(env, ctx, row)` is the production helper.
//     It catches every error, logs once, and (when `ctx` is undefined)
//     is a no-op. Auth handlers ALWAYS go through this path so that:
//       * audit-write failures NEVER reach the response hot path
//       * test stubs / internal re-entries that lack a real
//         ExecutionContext don't crash on `ctx.waitUntil`
//
// ────────────────────────────────────────────────────────────────
// Privacy / length handling
// ────────────────────────────────────────────────────────────────
//   - `userAgent`: truncated to 256 chars before insert. Longer UAs
//     are pathological — typical real-world max is ~200 chars.
//   - `ip`: rejected (row dropped + warn) when length > 64. A >64-char
//     "IP" is not an IP; it's almost certainly a header-shaping bug
//     and the right reaction is to skip the row rather than silently
//     persist a poisoned value. We do not truncate IPs — half an IP
//     is wrong, not just imprecise.
//   - We do NOT mask IP/UA at write time. The masked detail list
//     endpoint masks at read time so the audit-logged reveal endpoint
//     can return the raw value.

import type { Env } from "../env";
import { parseBotClass } from "./collect";
import type { BotClass } from "./types";

/** Maximum bytes we keep for `user_agent`. Real-world UAs run ~200 chars. */
const USER_AGENT_MAX = 256;

/** Maximum bytes we accept for `ip`. IPv6 maxes ~45 chars; >64 = broken. */
const IP_MAX = 64;

/**
 * Auth attempt kind — pinned to the worker's two instrumented handlers.
 * Adding a third kind here without also adding the corresponding handler
 * instrumentation is intentional dead code; tests assert no extra value.
 */
export type LoginHistoryKind = "login" | "register";

/**
 * Documented failure codes that the audit log persists. Every value here
 * corresponds to a real return branch in `apps/worker/src/handlers/auth.ts`.
 * If you remove a branch, remove the code; if you add a code without a
 * branch, the regression tests in `auth-login-history-instrumentation`
 * will fail. Empty string is the success case (ok=1).
 */
export type LoginHistoryErrorCode =
	| "" // success
	// login branches (auth.ts login())
	| "INVALID_CREDENTIALS"
	| "USER_BANNED"
	| "RATE_LIMITED_IP"
	| "LOCKED_OUT_IP"
	// register branches (auth.ts register())
	| "REGISTRATION_DISABLED"
	| "USERNAME_BANNED"
	| "RATE_LIMITED"
	| "EMAIL_ALREADY_IN_USE"
	| "USERNAME_TAKEN";

/**
 * One auth attempt row, pre-resolution and pre-truncation. The caller
 * supplies whatever it knows from the request after trust-edge resolution;
 * we apply length guards + bot classification inside the helper so every
 * call site is consistent.
 */
export interface LoginHistoryRow {
	/** Matched user id, or null if no user row matched (failed-username login / USERNAME_BANNED register). */
	userId: number | null;
	/** Username from the request body. Always populated by the caller. */
	username: string;
	/** 1 = success, 0 = failure. */
	ok: 0 | 1;
	kind: LoginHistoryKind;
	/** Empty string on success; documented enum on failure. */
	errorCode: LoginHistoryErrorCode;
	/** From `extractTrustedClientIp` — caller has already enforced non-empty. */
	ip: string;
	/** Raw User-Agent header (may be null/empty). */
	userAgent: string | null;
	/** Unix seconds. */
	createdAt: number;
}

/**
 * Insert ONE login_history row. Throws on D1 failure — production code
 * MUST go through `scheduleLoginHistory` so failures never reach the
 * response path. Public so tests can opt-in to seeing errors.
 *
 * Returns the inserted row's id on success. Returns `null` when the row
 * was rejected at the helper (e.g. IP > 64 chars) — this is NOT an
 * error from D1's perspective and would be logged at warn level.
 */
export async function insertLoginHistory(env: Env, row: LoginHistoryRow): Promise<number | null> {
	// Guard: a >64-char "IP" indicates a header-shaping bug; skip the
	// row rather than persist a poisoned value. The caller-side warn
	// happens in scheduleLoginHistory so production-path latency is
	// unaffected.
	if (row.ip.length > IP_MAX) {
		console.warn("[login-history] dropping row with oversized ip", {
			username: row.username,
			ipLength: row.ip.length,
		});
		return null;
	}

	const ua = (row.userAgent ?? "").slice(0, USER_AGENT_MAX);
	const botClass: BotClass = parseBotClass(row.userAgent);

	const result = await env.DB.prepare(
		`INSERT INTO login_history
			(user_id, username, ok, kind, error_code, ip, user_agent, bot_class, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			row.userId,
			row.username,
			row.ok,
			row.kind,
			row.errorCode,
			row.ip,
			ua,
			botClass,
			row.createdAt,
		)
		.run();

	const id = Number(result.meta.last_row_id);
	return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * Production helper: schedule a login_history insert deferred onto
 * `ctx.waitUntil`. Catches all errors and logs at warn level — failures
 * MUST NEVER propagate to the response hot path. When `ctx` is undefined
 * (test stubs, internal re-entries that don't have a real
 * ExecutionContext) this is a documented no-op so callers don't have to
 * branch on ctx presence themselves.
 *
 * Auth handlers ALWAYS call this. The hand-rolled `insertLoginHistory`
 * is only for tests + future direct callers (e.g. backfill scripts).
 */
export function scheduleLoginHistory(
	env: Env,
	ctx: ExecutionContext | undefined,
	row: LoginHistoryRow,
): void {
	if (!ctx) {
		// Documented no-op. Stub auth callers (tests, internal re-entries)
		// don't get audit rows — that's correct, because the test surface
		// for the audit log is the helper itself, not the handlers.
		return;
	}
	ctx.waitUntil(
		insertLoginHistory(env, row).catch((err) => {
			// Never throw out of the deferred path; the request has long
			// returned by the time this resolves.
			console.warn("[login-history] insert failed", err);
		}),
	);
}

/**
 * Drop login_history rows older than `retentionDays` (default 30).
 * Called from the daily Asia/Shanghai 03:00 cron branch in
 * `apps/worker/src/index.ts#scheduled`. Returns the number of rows
 * deleted (best-effort — D1 reports affected rows via meta.changes).
 *
 * Operational helper: errors propagate to the cron caller, which logs
 * them via the scheduled-handler error path. Failure here does NOT
 * affect any user request.
 */
export async function cleanupLoginHistory(env: Env, retentionDays = 30): Promise<number> {
	const cutoff = Math.floor(Date.now() / 1000) - retentionDays * 24 * 60 * 60;
	const result = await env.DB.prepare("DELETE FROM login_history WHERE created_at < ?")
		.bind(cutoff)
		.run();
	const changes = Number(result.meta.changes ?? 0);
	return Number.isFinite(changes) ? changes : 0;
}

// ─── Test-only internals ───────────────────────────────────────

/**
 * Internal handles for unit tests. Production code MUST import the
 * named exports above; this namespace is intentionally not part of the
 * helper's public surface and may change without notice.
 */
export const _internal = {
	USER_AGENT_MAX,
	IP_MAX,
};
