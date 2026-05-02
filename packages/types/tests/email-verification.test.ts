// Schema + copy lock for the EmailNotVerifiedPayload contract (docs/17 §5.4).
// This payload is referenced by Worker rejection responses, the web fetch
// wrapper's 403 fallback, and the web write-button pre-flight dialog. The
// schema and the canonical zh-CN copy are normative — any change has to come
// back through this test (and the docs).

import { describe, expect, it } from "vitest";
import {
	EMAIL_NOT_VERIFIED_PAYLOAD,
	type EmailNotVerifiedPayload,
	type EmailRequestCodeBody,
	type EmailVerifyCodeBody,
	cloneEmailNotVerifiedPayload,
} from "../src/email-verification";

describe("EMAIL_NOT_VERIFIED_PAYLOAD — docs/17 §5.4 contract", () => {
	it("matches the canonical schema and copy verbatim", () => {
		// If this assertion changes you MUST update docs/17 §5.4 and the web
		// dialog component in the same commit. Consider this the source-of-truth
		// snapshot for the rev4 payload.
		expect(EMAIL_NOT_VERIFIED_PAYLOAD).toEqual({
			error: "EMAIL_NOT_VERIFIED",
			message: "请先验证邮箱后再发布或回复内容。",
			dialog: {
				title: "需要验证邮箱",
				body: "你的账户还未验证邮箱，目前只能浏览。请前往个人中心绑定并验证邮箱后再继续。",
				cta_label: "去验证邮箱",
				cta_variant: "primary",
			},
			redirect_to: "/me#email",
		});
	});

	it("uses the literal string `EMAIL_NOT_VERIFIED` for the error discriminator (NOT the wrapped { error: { code } } shape)", () => {
		// Frontend dispatches dialogs by string-equal on `error`. If we ever
		// regress this to the wrapped shape, every dialog trigger silently
		// breaks.
		expect(typeof EMAIL_NOT_VERIFIED_PAYLOAD.error).toBe("string");
		expect(EMAIL_NOT_VERIFIED_PAYLOAD.error).toBe("EMAIL_NOT_VERIFIED");
	});

	it("redirect_to is a same-site relative path anchored at /me#email", () => {
		expect(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to).toBe("/me#email");
		expect(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to.startsWith("/")).toBe(true);
		expect(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to.startsWith("//")).toBe(false);
	});

	it("cta_variant is restricted to the rev4 enum", () => {
		// Reserved for future expansion; only `"primary"` ships in rev4.
		const allowed: ReadonlyArray<EmailNotVerifiedPayload["dialog"]["cta_variant"]> = ["primary"];
		expect(allowed).toContain(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.cta_variant);
	});
});

describe("cloneEmailNotVerifiedPayload — defensive copy", () => {
	it("returns a structurally equal payload", () => {
		expect(cloneEmailNotVerifiedPayload()).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("returns a fresh top-level object (no shared reference)", () => {
		const a = cloneEmailNotVerifiedPayload();
		const b = cloneEmailNotVerifiedPayload();
		expect(a).not.toBe(EMAIL_NOT_VERIFIED_PAYLOAD);
		expect(a).not.toBe(b);
	});

	it("returns a fresh nested dialog object so mutating a clone never touches the constant", () => {
		const a = cloneEmailNotVerifiedPayload();
		expect(a.dialog).not.toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog);
		// Mutate the clone — the constant must be unaffected.
		a.dialog.title = "MUTATED";
		expect(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.title).toBe("需要验证邮箱");
	});
});

describe("EmailRequestCodeBody / EmailVerifyCodeBody — wire shape (docs/17 §7.2 / §7.3, §9)", () => {
	it("EmailRequestCodeBody carries email + cf_turnstile_token, both string", () => {
		// Compile-time + structural check. Worker handler still validates at runtime.
		const body: EmailRequestCodeBody = {
			email: "user@example.com",
			cf_turnstile_token: "tok_abc",
		};
		expect(typeof body.email).toBe("string");
		expect(typeof body.cf_turnstile_token).toBe("string");
		// Required fields — listing them here is intentional. If the contract
		// grows a field, this test must be updated alongside docs §7.2.
		expect(Object.keys(body).sort()).toEqual(["cf_turnstile_token", "email"]);
	});

	it("EmailVerifyCodeBody carries email + code (no captcha at submit time)", () => {
		const body: EmailVerifyCodeBody = {
			email: "user@example.com",
			code: "123456",
		};
		expect(typeof body.email).toBe("string");
		expect(typeof body.code).toBe("string");
		expect(Object.keys(body).sort()).toEqual(["code", "email"]);
		// Guard against accidental captcha re-introduction at the verify step:
		// captcha was already burned at request-code time, adding it here only
		// frustrates the legitimate user.
		expect((body as Record<string, unknown>).cf_turnstile_token).toBeUndefined();
	});
});
