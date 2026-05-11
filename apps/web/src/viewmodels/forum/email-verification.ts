/**
 * Email verification ViewModel — pure logic for the EmailVerificationCard.
 *
 * Ref: docs/17-email-verification.md
 *
 * This module is intentionally framework-free: no React, no fetch. It exposes
 * the state machine, body builders, error → copy mapping, and config-validation
 * helpers consumed by the card component (and the same `/verify-email` deep
 * link that will reuse the card in 6D).
 *
 * Test boundaries
 * ---------------
 * Everything exported here is a pure function (`makeXxxBody`, `mapErrorCode`,
 * `nextState`, `validateCaptchaConfig`, …) so it can be exhaustively unit-
 * tested without spinning up React or DOM. The card component then becomes a
 * thin shell that just wires UI events to these functions.
 */

import type { EmailRequestCodeBody, EmailVerifyCodeBody } from "@ellie/types";

// ---------------------------------------------------------------------------
// Initial-user shape (subset of `User` the page passes in as a prop)
// ---------------------------------------------------------------------------

/**
 * The narrow slice of the authenticated User the card needs to render. This
 * avoids leaking unrelated User fields into the component prop type and makes
 * tests easier to seed.
 */
export interface EmailVerificationUserView {
	/** Current persisted email (may be empty if user has never set one). */
	email: string;
	/** Unix seconds when the current email was verified. 0 means unverified. */
	emailVerifiedAt: number;
}

// ---------------------------------------------------------------------------
// Card rendering modes — high-level "what is the user looking at"
// ---------------------------------------------------------------------------

/**
 * Top-level UI mode. The component picks one of these based on the user prop
 * and machine state — the card has three visually distinct stacks.
 */
export type CardMode =
	/**
	 * Already verified → show badge + verified email + "change email" affordance.
	 *
	 * NB: `email` may be the empty string. The Worker permits a `verified` user
	 * with no persisted email (legacy / migration). The component renders a
	 * fallback string ("已验证邮箱") in that case — verified takes precedence
	 * over the unbound stack so the badge is preserved.
	 */
	| { kind: "verified"; email: string; verifiedAt: number }
	/** No email on file yet → "你尚未绑定邮箱" + email input + Cap + send button. */
	| { kind: "unbound" }
	/** Email on file but not verified → "邮箱未验证" + same form (email pre-filled). */
	| { kind: "unverified"; email: string };

/**
 * Pick the rendering mode based purely on the user's current persisted
 * email + emailVerifiedAt. Pure function — no fallback logic baked into the
 * component.
 *
 * Precedence: verified beats every other mode. If `emailVerifiedAt > 0` the
 * card always shows the verified badge, even when `email` is an empty string
 * (the component shows a fallback label in that case). Only when
 * `emailVerifiedAt === 0` do we fall back to unbound / unverified based on
 * whether an email is on file.
 */
export function pickCardMode(user: EmailVerificationUserView): CardMode {
	const trimmed = user.email.trim();
	if (user.emailVerifiedAt > 0) {
		return { kind: "verified", email: trimmed, verifiedAt: user.emailVerifiedAt };
	}
	if (trimmed === "") {
		return { kind: "unbound" };
	}
	return { kind: "unverified", email: trimmed };
}

// ---------------------------------------------------------------------------
// State machine — what is the form doing right now
// ---------------------------------------------------------------------------

/**
 * The interactive form state. `idle` is the resting state where the user
 * can edit the email and solve the captcha; `sending` and `verifying` are
 * mid-flight network states that disable inputs.
 *
 * `verifying` carries the same `sentTo` / `nextResendAllowedAt` payload as
 * `code-sent` so a `verify_error` can return to the prior code-sent state
 * without requiring the caller to re-burn a captcha. This is the reviewer's
 * required behaviour (msg dcdbfacc): wrong code → stay in code-sent and let
 * the user re-enter the code.
 */
export type FormState =
	| { kind: "idle"; error: string | null }
	| { kind: "sending" }
	| {
			kind: "code-sent";
			sentTo: string;
			nextResendAllowedAt: number;
			codeDeadline: number;
			error: string | null;
	  }
	| { kind: "verifying"; sentTo: string; nextResendAllowedAt: number; codeDeadline: number }
	| { kind: "verified" }
	| { kind: "config-error"; reason: string };

/** Initial state — assumes config has been validated upstream. */
export const initialFormState: FormState = { kind: "idle", error: null };

/**
 * Card-level events the component dispatches. A reducer-style transition
 * function keeps the state machine testable and the UI dumb.
 */
export type FormEvent =
	| { type: "config_invalid"; reason: string }
	| { type: "send_start" }
	| { type: "send_success"; sentTo: string; nextResendAllowedAt: number; codeDeadline: number }
	| { type: "send_error"; message: string }
	| { type: "verify_start" }
	| { type: "verify_success" }
	| { type: "verify_error"; message: string }
	| { type: "reset_to_idle" };

/**
 * Pure state-machine transition. `nextState(prev, event)` returns the next
 * `FormState`, never mutates `prev`. Unknown transitions return `prev`
 * unchanged so the UI can emit events defensively.
 */
export function nextState(prev: FormState, event: FormEvent): FormState {
	// `config_invalid` is terminal from any state — config errors must lock
	// the form regardless of what was happening before.
	if (event.type === "config_invalid") {
		return { kind: "config-error", reason: event.reason };
	}
	if (prev.kind === "config-error") {
		// Once locked into config-error, only a fresh page load (unmount) clears
		// it; ignore any other event.
		return prev;
	}

	switch (event.type) {
		case "send_start":
			if (prev.kind === "idle" || prev.kind === "code-sent") {
				return { kind: "sending" };
			}
			return prev;

		case "send_success":
			if (prev.kind === "sending") {
				return {
					kind: "code-sent",
					sentTo: event.sentTo,
					nextResendAllowedAt: event.nextResendAllowedAt,
					codeDeadline: event.codeDeadline,
					error: null,
				};
			}
			return prev;

		case "send_error":
			if (prev.kind === "sending") {
				return { kind: "idle", error: event.message };
			}
			return prev;

		case "verify_start":
			if (prev.kind === "code-sent") {
				// Carry the code-sent payload into `verifying` so verify_error can
				// recover without a second captcha round-trip.
				return {
					kind: "verifying",
					sentTo: prev.sentTo,
					nextResendAllowedAt: prev.nextResendAllowedAt,
					codeDeadline: prev.codeDeadline,
				};
			}
			return prev;

		case "verify_success":
			if (prev.kind === "verifying") {
				return { kind: "verified" };
			}
			return prev;

		case "verify_error":
			if (prev.kind === "verifying") {
				return {
					kind: "code-sent",
					sentTo: prev.sentTo,
					nextResendAllowedAt: prev.nextResendAllowedAt,
					codeDeadline: prev.codeDeadline,
					error: event.message,
				};
			}
			return prev;

		case "reset_to_idle":
			return { kind: "idle", error: null };

		default: {
			const _exhaustive: never = event;
			return prev;
		}
	}
}

// ---------------------------------------------------------------------------
// Request body builders (project, never spread)
// ---------------------------------------------------------------------------

/**
 * Build the `EmailRequestCodeBody`. The card component MUST call this — it
 * keeps the wire shape consistent with the proxy's projection guard so the
 * Worker contract stays the single source of truth.
 */
export function makeRequestCodeBody(email: string): EmailRequestCodeBody {
	return {
		email: email.trim(),
	};
}

/**
 * Build the `EmailVerifyCodeBody`. Per docs/17 §7.3 this MUST NOT include a
 * captcha token (already burned at request-code time).
 */
export function makeVerifyBody(email: string, code: string): EmailVerifyCodeBody {
	return {
		email: email.trim(),
		code: code.trim(),
	};
}

// ---------------------------------------------------------------------------
// Client-side input validation (cheap pre-flight)
// ---------------------------------------------------------------------------

/** Loose email regex — same fence the Worker uses (apps/worker/src/lib/email.ts). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Six ASCII digits exactly. */
const CODE_REGEX = /^\d{6}$/;

export function isValidEmailFormat(email: string): boolean {
	const trimmed = email.trim();
	if (trimmed.length === 0 || trimmed.length > 254) return false;
	return EMAIL_REGEX.test(trimmed);
}

export function isValidCodeFormat(code: string): boolean {
	return CODE_REGEX.test(code.trim());
}

// ---------------------------------------------------------------------------
// Error code → Chinese copy (locked to docs/17 §6 wording)
// ---------------------------------------------------------------------------

/**
 * Map a Worker / proxy error code to user-facing Chinese copy. Unknown codes
 * fall back to a generic message so the card never shows a raw machine code.
 * The dialog dispatch for `EMAIL_NOT_VERIFIED` is handled by Phase 7 — this
 * map is for inline form errors only.
 */
export function mapErrorCode(code: string, fallback?: string): string {
	switch (code) {
		// ── Captcha ──
		case "CAPTCHA_REQUIRED":
			return "请先完成人机验证。";
		case "CAPTCHA_INVALID":
			return "人机验证未通过，请刷新后重试。";

		// ── Email ──
		case "EMAIL_INVALID":
			return "邮箱格式无效，请检查后重试。";
		case "EMAIL_ALREADY_IN_USE":
			return "该邮箱已被其他账户绑定。";
		case "EMAIL_ALREADY_VERIFIED":
			return "该邮箱已经验证过了。";

		// ── Code (request-code resend throttle) ──
		case "CODE_RESEND_THROTTLED":
			return "发送过于频繁，请稍后再试。";

		// ── Code (verify) ──
		case "CODE_FORMAT_INVALID":
			return "验证码格式不正确，请输入 6 位数字。";
		case "CODE_NOT_FOUND":
			return "验证码不存在或已过期，请重新发送。";
		case "CODE_INVALID":
			return "验证码错误，请重新输入。";
		case "CODE_LOCKED":
			return "尝试次数过多，请重新发送验证码。";
		case "EMAIL_CODE_EMAIL_MISMATCH":
			return "验证码与邮箱不匹配，请确认后重试。";

		// ── Provider / system ──
		case "EMAIL_PROVIDER_FAILED":
			return "邮件发送失败，请稍后重试。";
		case "USER_NOT_FOUND":
			return "用户不存在，请重新登录。";
		case "INVALID_BODY":
			return "请求格式错误，请刷新页面重试。";

		// ── Proxy fences ──
		case "NOT_AUTHENTICATED":
			return "登录已过期，请重新登录。";
		case "CSRF_REJECTED":
			return "请求被拒绝，请刷新页面重试。";
		case "INTERNAL_ERROR":
			return "服务器内部错误，请稍后重试。";

		default:
			return fallback?.trim() || "操作失败，请稍后重试。";
	}
}

// ---------------------------------------------------------------------------
// Wrapped error envelope parsing
// ---------------------------------------------------------------------------

/**
 * Parse a `{ error: { code, message } }` JSON body the proxy returns for
 * non-§5.4 errors. Robust to missing/wrong-typed fields. Returns `null` if
 * the body is not in the wrapped shape (caller can then fall through to
 * a default message).
 */
export function parseWrappedError(
	body: unknown,
): { code: string; message: string | undefined } | null {
	if (body == null || typeof body !== "object") return null;
	const top = (body as Record<string, unknown>).error;
	if (top == null || typeof top !== "object") return null;
	const inner = top as Record<string, unknown>;
	if (typeof inner.code !== "string") return null;
	return {
		code: inner.code,
		message: typeof inner.message === "string" ? inner.message : undefined,
	};
}

/** Convenience: parseWrappedError + mapErrorCode in one call. */
export function describeWrappedError(body: unknown, status: number): string {
	const parsed = parseWrappedError(body);
	if (parsed) return mapErrorCode(parsed.code, parsed.message);
	if (status >= 500) return "服务器内部错误，请稍后重试。";
	if (status === 401) return "登录已过期，请重新登录。";
	return "操作失败，请稍后重试。";
}

// ---------------------------------------------------------------------------
// Captcha config validation (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Validate the Cap API endpoint passed in from `NEXT_PUBLIC_CAP_API_ENDPOINT`.
 *
 * A missing/blank endpoint MUST surface as an explicit configuration error in
 * the viewmodel and UI, and any attempt to call `request-code` MUST be
 * blocked. Returning `{ ok: false }` here is what the card uses to dispatch
 * the `config_invalid` event into the state machine.
 */
export function validateCaptchaConfig(
	apiEndpoint: string | undefined,
): { ok: true; apiEndpoint: string } | { ok: false; reason: string } {
	if (apiEndpoint == null || apiEndpoint.trim() === "") {
		return {
			ok: false,
			reason: "邮箱验证暂不可用：站点未配置 NEXT_PUBLIC_CAP_API_ENDPOINT，请联系管理员。",
		};
	}
	return { ok: true, apiEndpoint: apiEndpoint.trim() };
}

/**
 * Combined pre-flight check: the form is OK to call request-code only when
 *   - Cap config is valid AND
 *   - the user has solved the widget (token is non-empty) AND
 *   - the email has a syntactically valid format.
 *
 * Returns `null` when ready, or a user-facing error message when blocked.
 */
export function requestCodePreflight(args: {
	apiEndpoint: string | undefined;
	capToken: string | null;
	email: string;
}): string | null {
	const cfg = validateCaptchaConfig(args.apiEndpoint);
	if (!cfg.ok) return cfg.reason;
	if (!isValidEmailFormat(args.email)) return mapErrorCode("EMAIL_INVALID");
	if (args.capToken == null || args.capToken.trim() === "") {
		return mapErrorCode("CAPTCHA_REQUIRED");
	}
	return null;
}
