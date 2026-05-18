/**
 * Write-gate — unified preflight check for all write actions.
 *
 * Before opening any write dialog (new thread, reply, comment, message, report),
 * the UI calls `writeGatePreflight(emailVerifiedAt, action)` which:
 *   1. Checks email verification locally (fast sync path for known state)
 *   2. Calls GET /api/v1/posting-permission?action=X for content switches,
 *      registration days, avatar, etc.
 *   3. If blocked, dispatches a global dialog event so the user sees why
 *
 * The write-gate is a UX convenience — the server-side `withVerifiedEmail` +
 * `checkPostingPermission` guards remain the security boundary.
 *
 * Cache: results are cached per action for CACHE_TTL_MS (30s) to avoid hitting
 * the API on every button click. `invalidateWriteGateCache()` clears the cache
 * when the user takes an action that changes their permission state (e.g.
 * just verified email, just set avatar).
 */

import { ApiError, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Frontend write action types — each maps to a backend content-type check.
 *
 * Note: `"rating"` is a Worker-side no-op for content switches (falls through
 * to the "message" content-type default in `actionToContentType`), but we use
 * it as a distinct action key so the cache slot, the §5.4 dispatch reason,
 * and the future content-switch is kept separable from comments/reports.
 */
export type WriteGateAction = "thread" | "reply" | "comment" | "message" | "report" | "rating";

/** Result from the posting-permission API */
export interface PostingPermissionResult {
	allowed: boolean;
	reason?: string;
	code?: string;
}

/** Write-gate check result */
export type WriteGateResult = { blocked: false } | { blocked: true; reason: string; code: string };

/** Detail shape of the dispatched write-gate event */
export interface WriteGateEventDetail {
	reason: string;
	code: string;
}

// ---------------------------------------------------------------------------
// Event dispatch
// ---------------------------------------------------------------------------

/** Custom event name for the global write-gate dialog */
export const WRITE_GATE_EVENT = "ellie:write-blocked" as const;

/**
 * Browser-only: dispatch the write-gate event. No-op on the server.
 */
export function dispatchWriteGate(detail: WriteGateEventDetail): boolean {
	if (typeof window === "undefined") return false;
	window.dispatchEvent(new CustomEvent<WriteGateEventDetail>(WRITE_GATE_EVENT, { detail }));
	return true;
}

// ---------------------------------------------------------------------------
// CTA mapping (frontend knows the routes, worker doesn't)
// ---------------------------------------------------------------------------

/** Map restriction code to an actionable redirect URL, if any. */
export function codeToRedirect(code: string): string | undefined {
	switch (code) {
		case "EMAIL_NOT_VERIFIED":
			return "/verify-email";
		case "REQUIRE_AVATAR":
			return "/me#avatar";
		default:
			return undefined;
	}
}

/** Map restriction code to a CTA button label, if any. */
export function codeToCtaLabel(code: string): string | undefined {
	switch (code) {
		case "EMAIL_NOT_VERIFIED":
			return "去验证邮箱";
		case "REQUIRE_AVATAR":
			return "去设置头像";
		default:
			return undefined;
	}
}

// ---------------------------------------------------------------------------
// Onboarding progress — pure viewmodel helper for WriteGateDialog
// ---------------------------------------------------------------------------

/** Status of a single onboarding step. */
export type OnboardingStepStatus = "done" | "current" | "pending";

/** A single onboarding step shown in the write-gate dialog progress strip. */
export interface OnboardingStep {
	label: string;
	status: OnboardingStepStatus;
}

/**
 * Map a write-gate restriction code to the three onboarding steps new users
 * must complete before they can post: verify email → set avatar → wait one
 * full day since registration.
 *
 * Only the three "new user" codes produce a non-empty array; any other
 * restriction (content switch off, banned, etc.) returns `[]` so the dialog
 * doesn't show misleading progress for unrelated blocks.
 */
export function getWriteGateOnboardingSteps(code: string): OnboardingStep[] {
	switch (code) {
		case "EMAIL_NOT_VERIFIED":
			return [
				{ label: "验证邮箱", status: "current" },
				{ label: "设置头像", status: "pending" },
				{ label: "注册满一天", status: "pending" },
			];
		case "REQUIRE_AVATAR":
			return [
				{ label: "验证邮箱", status: "done" },
				{ label: "设置头像", status: "current" },
				{ label: "注册满一天", status: "pending" },
			];
		case "MIN_REGISTRATION_DAYS":
			return [
				{ label: "验证邮箱", status: "done" },
				{ label: "设置头像", status: "done" },
				{ label: "注册满一天", status: "current" },
			];
		default:
			return [];
	}
}

// ---------------------------------------------------------------------------
// Permission cache — keyed by action
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { result: WriteGateResult; timestamp: number }>();

/**
 * Clear the cached permission results — call after user takes an action
 * that could change their permission state (verified email, set avatar).
 * When `action` is specified, only that action's cache entry is cleared;
 * otherwise all entries are cleared.
 */
export function invalidateWriteGateCache(action?: WriteGateAction): void {
	if (action) {
		cache.delete(action);
	} else {
		cache.clear();
	}
}

// ---------------------------------------------------------------------------
// Core check
// ---------------------------------------------------------------------------

/**
 * Check if the user is allowed to write. Returns { blocked: false } if
 * allowed, or { blocked: true, reason, code } if not.
 *
 * @param emailVerifiedAt - Server-projected value. `0` means unverified,
 *   positive means verified, `null` means unknown (anonymous or load failed).
 * @param action - The write action being attempted. Determines which backend
 *   content switches are checked (e.g. allow_new_thread for "thread").
 *   Defaults to "message" (no content switch checks).
 */
export async function checkWriteGate(
	emailVerifiedAt: number | null | undefined,
	action: WriteGateAction = "message",
): Promise<WriteGateResult> {
	// Fast path: if we know locally that email is unverified, don't bother
	// with the API call. This matches the preflightEmailVerifiedBlock semantics:
	// only block on exactly 0, never on null (unknown).
	if (emailVerifiedAt === 0) {
		return {
			blocked: true,
			reason: "请先验证邮箱后再进行操作",
			code: "EMAIL_NOT_VERIFIED",
		};
	}

	// Check cache (keyed by action)
	const cached = cache.get(action);
	if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
		return cached.result;
	}

	// API call with action parameter
	try {
		const res = await apiClient.get<PostingPermissionResult>("/api/v1/posting-permission", {
			action,
		});
		const data = res.data;

		if (data.allowed) {
			const result: WriteGateResult = { blocked: false };
			cache.set(action, { result, timestamp: Date.now() });
			return result;
		}

		const result: WriteGateResult = {
			blocked: true,
			reason: data.reason ?? "您暂时无法操作",
			code: data.code ?? "POSTING_RESTRICTION",
		};
		cache.set(action, { result, timestamp: Date.now() });
		return result;
	} catch (err) {
		if (err instanceof ApiError) {
			// If the API returns an auth error, don't cache — user may need
			// to re-login.
			return {
				blocked: true,
				reason: err.message || "请登录后再进行操作",
				code: err.code || "UNAUTHORIZED",
			};
		}
		// Network error — don't block, let the server-side guard handle it
		return { blocked: false };
	}
}

/**
 * Preflight: at the moment a write affordance is clicked, check all
 * posting conditions and open the write-gate dialog if blocked.
 *
 * Returns `true` when the affordance should be BLOCKED (caller should NOT
 * open the write UI). Returns `false` when the write is allowed.
 *
 * This replaces `preflightEmailVerifiedBlock` for write entry points —
 * it covers email verification AND posting restrictions in one call.
 *
 * @param emailVerifiedAt - Server-projected value (0=unverified, null=unknown).
 * @param action - The write action (determines content switch checks).
 */
export async function writeGatePreflight(
	emailVerifiedAt: number | null | undefined,
	action: WriteGateAction = "message",
): Promise<boolean> {
	const result = await checkWriteGate(emailVerifiedAt, action);
	if (!result.blocked) return false;

	dispatchWriteGate({ reason: result.reason, code: result.code });
	return true;
}
