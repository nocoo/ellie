/**
 * Tests for the email-verification viewmodel (apps/web/src/viewmodels/forum/
 * email-verification.ts).
 *
 * The viewmodel is the testable substrate of the EmailVerificationCard: it
 * owns the state machine, request-body shape, error mapping, and captcha
 * config validation. The component layer should remain a thin shell — these
 * tests lock the contract end-to-end.
 */

import { describe, expect, it } from "vitest";
import {
	type CardMode,
	describeWrappedError,
	type FormState,
	initialFormState,
	isValidCodeFormat,
	isValidEmailFormat,
	makeRequestCodeBody,
	makeVerifyBody,
	mapErrorCode,
	nextState,
	parseWrappedError,
	pickCardMode,
	requestCodePreflight,
	validateCaptchaConfig,
} from "@/viewmodels/forum/email-verification";

// ─── pickCardMode ─────────────────────────────────────────────────────────────
describe("pickCardMode", () => {
	it("returns verified when emailVerifiedAt > 0 AND email is non-empty", () => {
		const m = pickCardMode({ email: "x@y.io", emailVerifiedAt: 1700000000 });
		expect(m).toEqual<CardMode>({
			kind: "verified",
			email: "x@y.io",
			verifiedAt: 1700000000,
		});
	});

	it("trims surrounding whitespace on the verified email", () => {
		const m = pickCardMode({ email: "  x@y.io  ", emailVerifiedAt: 100 });
		expect(m).toEqual<CardMode>({ kind: "verified", email: "x@y.io", verifiedAt: 100 });
	});

	it("verified takes precedence even when email is empty (legacy/migration fallback)", () => {
		expect(pickCardMode({ email: "", emailVerifiedAt: 1 })).toEqual<CardMode>({
			kind: "verified",
			email: "",
			verifiedAt: 1,
		});
		expect(pickCardMode({ email: "   ", emailVerifiedAt: 100 })).toEqual<CardMode>({
			kind: "verified",
			email: "",
			verifiedAt: 100,
		});
	});

	it("returns unbound only when emailVerifiedAt === 0 AND email is empty", () => {
		expect(pickCardMode({ email: "", emailVerifiedAt: 0 })).toEqual<CardMode>({ kind: "unbound" });
		expect(pickCardMode({ email: "   ", emailVerifiedAt: 0 })).toEqual<CardMode>({
			kind: "unbound",
		});
	});

	it("returns unverified when email is set but emailVerifiedAt is 0", () => {
		expect(pickCardMode({ email: "x@y.io", emailVerifiedAt: 0 })).toEqual<CardMode>({
			kind: "unverified",
			email: "x@y.io",
		});
	});
});

// ─── nextState (state machine) ────────────────────────────────────────────────
describe("nextState", () => {
	it("starts at idle with no error", () => {
		expect(initialFormState).toEqual<FormState>({ kind: "idle", error: null });
	});

	it("idle → sending on send_start", () => {
		const s = nextState(initialFormState, { type: "send_start" });
		expect(s).toEqual<FormState>({ kind: "sending" });
	});

	it("sending → code-sent on send_success carries sentTo + nextResendAllowedAt + codeDeadline", () => {
		const s = nextState(
			{ kind: "sending" },
			{
				type: "send_success",
				sentTo: "x***@y.io",
				nextResendAllowedAt: 1700000060,
				codeDeadline: 1700000900,
			},
		);
		expect(s).toEqual<FormState>({
			kind: "code-sent",
			sentTo: "x***@y.io",
			nextResendAllowedAt: 1700000060,
			codeDeadline: 1700000900,
			error: null,
		});
	});

	it("sending → idle (with error) on send_error", () => {
		const s = nextState({ kind: "sending" }, { type: "send_error", message: "boom" });
		expect(s).toEqual<FormState>({ kind: "idle", error: "boom" });
	});

	it("code-sent → verifying carries sentTo / nextResendAllowedAt / codeDeadline forward", () => {
		const s = nextState(
			{
				kind: "code-sent",
				sentTo: "x***@y.io",
				nextResendAllowedAt: 1700000060,
				codeDeadline: 1700000900,
				error: null,
			},
			{ type: "verify_start" },
		);
		expect(s).toEqual<FormState>({
			kind: "verifying",
			sentTo: "x***@y.io",
			nextResendAllowedAt: 1700000060,
			codeDeadline: 1700000900,
		});
	});

	it("verifying → verified on verify_success (terminal happy path)", () => {
		const s = nextState(
			{
				kind: "verifying",
				sentTo: "x***@y.io",
				nextResendAllowedAt: 1700000060,
				codeDeadline: 1700000900,
			},
			{ type: "verify_success" },
		);
		expect(s).toEqual<FormState>({ kind: "verified" });
	});

	it("verifying → code-sent (with inline error) on verify_error — keeps sentTo so user can retry without re-captcha", () => {
		const s = nextState(
			{
				kind: "verifying",
				sentTo: "x***@y.io",
				nextResendAllowedAt: 1700000060,
				codeDeadline: 1700000900,
			},
			{ type: "verify_error", message: "码错" },
		);
		expect(s).toEqual<FormState>({
			kind: "code-sent",
			sentTo: "x***@y.io",
			nextResendAllowedAt: 1700000060,
			codeDeadline: 1700000900,
			error: "码错",
		});
	});

	it("verify_error → user can verify_start again from the recovered code-sent state", () => {
		const afterError = nextState(
			{
				kind: "verifying",
				sentTo: "x***@y.io",
				nextResendAllowedAt: 42,
				codeDeadline: 1700000900,
			},
			{ type: "verify_error", message: "wrong" },
		);
		expect(afterError.kind).toBe("code-sent");
		const retried = nextState(afterError, { type: "verify_start" });
		expect(retried).toEqual<FormState>({
			kind: "verifying",
			sentTo: "x***@y.io",
			nextResendAllowedAt: 42,
			codeDeadline: 1700000900,
		});
	});

	it("config_invalid is terminal from any state", () => {
		const states: FormState[] = [
			{ kind: "idle", error: null },
			{ kind: "sending" },
			{
				kind: "code-sent",
				sentTo: "x",
				nextResendAllowedAt: 0,
				codeDeadline: 1700000900,
				error: null,
			},
			{ kind: "verifying", sentTo: "x", nextResendAllowedAt: 0, codeDeadline: 1700000900 },
			{ kind: "verified" },
		];
		for (const s of states) {
			expect(nextState(s, { type: "config_invalid", reason: "no-key" })).toEqual<FormState>({
				kind: "config-error",
				reason: "no-key",
			});
		}
	});

	it("config-error swallows every subsequent event (locked)", () => {
		const cfgErr: FormState = { kind: "config-error", reason: "no-key" };
		expect(nextState(cfgErr, { type: "send_start" })).toBe(cfgErr);
		expect(nextState(cfgErr, { type: "verify_start" })).toBe(cfgErr);
		expect(nextState(cfgErr, { type: "reset_to_idle" })).toBe(cfgErr);
	});

	it("ignores out-of-order events without changing state", () => {
		const idle: FormState = { kind: "idle", error: null };
		expect(
			nextState(idle, {
				type: "send_success",
				sentTo: "x",
				nextResendAllowedAt: 0,
				codeDeadline: 0,
			}),
		).toBe(idle);
		expect(nextState(idle, { type: "verify_start" })).toBe(idle);
	});

	it("reset_to_idle clears any inline error", () => {
		const withErr: FormState = { kind: "idle", error: "old" };
		expect(nextState(withErr, { type: "reset_to_idle" })).toEqual<FormState>({
			kind: "idle",
			error: null,
		});
	});

	it("reset_to_idle from code-sent returns to idle (change-email flow)", () => {
		const codeSent: FormState = {
			kind: "code-sent",
			sentTo: "x@y.io",
			nextResendAllowedAt: 42,
			codeDeadline: 1700000900,
			error: null,
		};
		expect(nextState(codeSent, { type: "reset_to_idle" })).toEqual<FormState>({
			kind: "idle",
			error: null,
		});
	});

	it("code-sent → sending on send_start (resend path)", () => {
		const codeSent: FormState = {
			kind: "code-sent",
			sentTo: "x@y.io",
			nextResendAllowedAt: 0,
			codeDeadline: 1700000900,
			error: null,
		};
		expect(nextState(codeSent, { type: "send_start" })).toEqual<FormState>({
			kind: "sending",
		});
	});
});

// ─── makeRequestCodeBody / makeVerifyBody ────────────────────────────────────
describe("makeRequestCodeBody", () => {
	it("projects to { email } and trims", () => {
		expect(makeRequestCodeBody("  x@y.io  ")).toEqual({
			email: "x@y.io",
		});
	});

	it("returns exactly one key (no extras)", () => {
		const body = makeRequestCodeBody("x@y.io");
		expect(Object.keys(body)).toEqual(["email"]);
	});
});

describe("makeVerifyBody", () => {
	it("projects to { email, code } and trims both — never includes cf_turnstile_token", () => {
		const body = makeVerifyBody("  x@y.io  ", "  123456  ");
		expect(body).toEqual({ email: "x@y.io", code: "123456" });
		expect((body as Record<string, unknown>).cf_turnstile_token).toBeUndefined();
	});

	it("returns exactly two keys (no extras)", () => {
		const body = makeVerifyBody("x@y.io", "123456");
		expect(Object.keys(body).sort()).toEqual(["code", "email"]);
	});
});

// ─── input validation ───────────────────────────────────────────────────────
describe("isValidEmailFormat", () => {
	it.each([
		["x@y.io", true],
		["a.b+tag@example.com", true],
		["", false],
		["   ", false],
		["no-at", false],
		["a@b", false], // no TLD dot
		["@y.io", false],
		["x@", false],
		[`${"a".repeat(250)}@y.io`, false], // > 254
	])("isValidEmailFormat(%j) = %s", (input, expected) => {
		expect(isValidEmailFormat(input)).toBe(expected);
	});
});

describe("isValidCodeFormat", () => {
	it.each([
		["123456", true],
		["  123456 ", true],
		["12345", false],
		["1234567", false],
		["12345a", false],
		["", false],
	])("isValidCodeFormat(%j) = %s", (input, expected) => {
		expect(isValidCodeFormat(input)).toBe(expected);
	});
});

// ─── mapErrorCode ────────────────────────────────────────────────────────────
describe("mapErrorCode", () => {
	it.each([
		// Captcha (retained mapping for backwards compatibility)
		"CAPTCHA_REQUIRED",
		"CAPTCHA_INVALID",
		// Email
		"EMAIL_INVALID",
		"EMAIL_ALREADY_IN_USE",
		"EMAIL_ALREADY_VERIFIED",
		"EMAIL_NOT_CORRECTABLE",
		"EMAIL_CORRECTION_USED",
		"EMAIL_UNCHANGED",
		// Code throttle (request-code)
		"CODE_RESEND_THROTTLED",
		// Code (verify)
		"CODE_FORMAT_INVALID",
		"CODE_NOT_FOUND",
		"CODE_INVALID",
		"CODE_LOCKED",
		"EMAIL_CODE_EMAIL_MISMATCH",
		// Provider / system
		"EMAIL_PROVIDER_FAILED",
		"USER_NOT_FOUND",
		"INVALID_BODY",
		// Proxy fences
		"NOT_AUTHENTICATED",
		"CSRF_REJECTED",
		"INTERNAL_ERROR",
	])("returns a non-empty Chinese string for known code %s", (code) => {
		const msg = mapErrorCode(code);
		expect(msg).toMatch(/[一-龥]/);
		expect(msg.length).toBeGreaterThan(0);
		expect(msg).not.toBe("操作失败，请稍后重试。");
	});

	it("CODE_NOT_FOUND copy mentions resending", () => {
		expect(mapErrorCode("CODE_NOT_FOUND")).toBe("验证码不存在或已过期，请重新发送。");
	});

	it("CODE_LOCKED copy tells the user to resend", () => {
		expect(mapErrorCode("CODE_LOCKED")).toBe("尝试次数过多，请重新发送验证码。");
	});

	it("falls back to a generic Chinese message for unknown codes", () => {
		expect(mapErrorCode("WHATEVER_NEW_CODE")).toBe("操作失败，请稍后重试。");
	});

	it("uses fallback override when provided and code is unknown", () => {
		expect(mapErrorCode("WHATEVER", "  自定义提示 ")).toBe("自定义提示");
	});

	it("ignores empty fallback strings on unknown codes", () => {
		expect(mapErrorCode("WHATEVER", "")).toBe("操作失败，请稍后重试。");
		expect(mapErrorCode("WHATEVER", "   ")).toBe("操作失败，请稍后重试。");
	});
});

// ─── parseWrappedError + describeWrappedError ───────────────────────────────
describe("parseWrappedError", () => {
	it("returns code+message for a wrapped { error: { code, message } } body", () => {
		expect(parseWrappedError({ error: { code: "CODE_INVALID", message: "wrong" } })).toEqual({
			code: "CODE_INVALID",
			message: "wrong",
		});
	});

	it("tolerates missing message", () => {
		expect(parseWrappedError({ error: { code: "X" } })).toEqual({
			code: "X",
			message: undefined,
		});
	});

	it("returns null for §5.4 flat shape (handled by Phase 7 dialog dispatch)", () => {
		expect(
			parseWrappedError({
				error: "EMAIL_NOT_VERIFIED",
				message: "x",
				dialog: {},
				redirect_to: "/me#email",
			}),
		).toBeNull();
	});

	it("returns null for non-objects", () => {
		expect(parseWrappedError(null)).toBeNull();
		expect(parseWrappedError(undefined)).toBeNull();
		expect(parseWrappedError("nope")).toBeNull();
		expect(parseWrappedError(42)).toBeNull();
	});

	it("returns null when error.code is not a string", () => {
		expect(parseWrappedError({ error: { code: 123, message: "x" } })).toBeNull();
		expect(parseWrappedError({ error: {} })).toBeNull();
	});
});

describe("describeWrappedError", () => {
	it("maps the wrapped code via mapErrorCode", () => {
		expect(describeWrappedError({ error: { code: "CODE_INVALID", message: "x" } }, 400)).toBe(
			"验证码错误，请重新输入。",
		);
	});

	it("falls back to generic 5xx copy on server errors with unparseable body", () => {
		expect(describeWrappedError(null, 500)).toBe("服务器内部错误，请稍后重试。");
	});

	it("falls back to NOT_AUTHENTICATED copy on 401 with unparseable body", () => {
		expect(describeWrappedError(null, 401)).toBe("登录已过期，请重新登录。");
	});

	it("falls back to generic copy on other statuses with unparseable body", () => {
		expect(describeWrappedError(null, 400)).toBe("操作失败，请稍后重试。");
	});
});

// ─── validateCaptchaConfig ────────────────────────────────────────────────
describe("validateCaptchaConfig (fail-closed)", () => {
	it("returns ok with trimmed endpoint for a non-empty string", () => {
		expect(validateCaptchaConfig("  https://cap.example.com/key/  ")).toEqual({
			ok: true,
			apiEndpoint: "https://cap.example.com/key/",
		});
	});

	it("fails closed for undefined", () => {
		const r = validateCaptchaConfig(undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/NEXT_PUBLIC_CAP_API_ENDPOINT/);
	});

	it("fails closed for empty string", () => {
		expect(validateCaptchaConfig("").ok).toBe(false);
	});

	it("fails closed for whitespace-only string", () => {
		expect(validateCaptchaConfig("   ").ok).toBe(false);
	});
});

// ─── requestCodePreflight ───────────────────────────────────────────────────
describe("requestCodePreflight (combined gate)", () => {
	it("returns null when config + email + token are all valid", () => {
		expect(
			requestCodePreflight({
				apiEndpoint: "https://cap.example.com/key/",
				capToken: "tok",
				email: "x@y.io",
			}),
		).toBeNull();
	});

	it("blocks when api endpoint is missing (fail-closed) — even if token+email look fine", () => {
		const msg = requestCodePreflight({
			apiEndpoint: undefined,
			capToken: "tok",
			email: "x@y.io",
		});
		expect(msg).not.toBeNull();
		expect(msg).toMatch(/NEXT_PUBLIC_CAP_API_ENDPOINT/);
	});

	it("blocks on bad email format", () => {
		expect(
			requestCodePreflight({
				apiEndpoint: "https://cap.example.com/key/",
				capToken: "tok",
				email: "no-at",
			}),
		).toBe("邮箱格式无效，请检查后重试。");
	});

	it("blocks when cap token is null/empty (captcha not solved)", () => {
		expect(
			requestCodePreflight({
				apiEndpoint: "https://cap.example.com/key/",
				capToken: null,
				email: "x@y.io",
			}),
		).toBe("请先完成人机验证。");
		expect(
			requestCodePreflight({
				apiEndpoint: "https://cap.example.com/key/",
				capToken: "   ",
				email: "x@y.io",
			}),
		).toBe("请先完成人机验证。");
	});

	it("config error takes precedence over email and captcha errors", () => {
		const msg = requestCodePreflight({
			apiEndpoint: undefined,
			capToken: null,
			email: "no-at",
		});
		expect(msg).toMatch(/NEXT_PUBLIC_CAP_API_ENDPOINT/);
	});

	it("email error takes precedence over captcha error", () => {
		expect(
			requestCodePreflight({
				apiEndpoint: "https://cap.example.com/key/",
				capToken: null,
				email: "no-at",
			}),
		).toBe("邮箱格式无效，请检查后重试。");
	});
});
