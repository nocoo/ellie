// Tests for the email-not-verified dispatch viewmodel
// (apps/web/src/viewmodels/forum/email-not-verified-dispatch.ts).
//
// Three surfaces under test:
//   1. `isEmailNotVerifiedPayloadClient` — the client-side fingerprint guard
//      that mirrors the server `isEmailNotVerifiedPayload`. Reviewer's msg
//      0e069f5b: a malformed body (missing dialog / redirect_to / wrong
//      shape) must NOT trigger the dispatch path.
//   2. `pickDialogPayload` — uses the wire body when valid, otherwise falls
//      back to `EMAIL_NOT_VERIFIED_PAYLOAD`. Used by the fetch wrapper for
//      live responses and by the write-button preflight (no wire body yet).
//   3. `dispatchEmailNotVerified` — browser-only; no-op on the server.
//      The vitest env is "node", so we stub `window` for the browser case.

import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	dispatchEmailNotVerified,
	EMAIL_NOT_VERIFIED_EVENT,
	isEmailNotVerifiedPayloadClient,
	normalizeCtaVariant,
	pickDialogPayload,
	preflightEmailVerifiedBlock,
} from "@/viewmodels/forum/email-not-verified-dispatch";

describe("EMAIL_NOT_VERIFIED_EVENT", () => {
	it("is the documented event name", () => {
		// The dialog mount listens for this exact string. If we ever rename it
		// the mount and the dispatcher would silently drift apart.
		expect(EMAIL_NOT_VERIFIED_EVENT).toBe("ellie:email-not-verified");
	});
});

describe("isEmailNotVerifiedPayloadClient", () => {
	it("accepts the canonical EMAIL_NOT_VERIFIED_PAYLOAD constant verbatim", () => {
		expect(isEmailNotVerifiedPayloadClient(EMAIL_NOT_VERIFIED_PAYLOAD)).toBe(true);
	});

	it("accepts a body with cta_variant absent (forgiving fingerprint)", () => {
		// The constant ships cta_variant, but the guard intentionally allows
		// it to be missing so a minor wire variation doesn't break the dispatch.
		const body = {
			error: "EMAIL_NOT_VERIFIED",
			message: "请先验证邮箱",
			redirect_to: "/me#email",
			dialog: { title: "x", body: "y", cta_label: "z" },
		};
		expect(isEmailNotVerifiedPayloadClient(body)).toBe(true);
	});

	it("rejects null / undefined / non-object inputs", () => {
		expect(isEmailNotVerifiedPayloadClient(null)).toBe(false);
		expect(isEmailNotVerifiedPayloadClient(undefined)).toBe(false);
		expect(isEmailNotVerifiedPayloadClient("EMAIL_NOT_VERIFIED")).toBe(false);
		expect(isEmailNotVerifiedPayloadClient(42)).toBe(false);
	});

	it("rejects the wrapped { error: { code, message } } shape", () => {
		// All other Worker errors use the wrapped envelope. The §5.4 dispatch
		// is keyed on `error` being a top-level literal string, so this MUST
		// fall through to the generic 403 branch.
		const wrapped = {
			error: { code: "EMAIL_NOT_VERIFIED", message: "x" },
			redirect_to: "/me#email",
			dialog: { title: "x", body: "y", cta_label: "z" },
		};
		expect(isEmailNotVerifiedPayloadClient(wrapped)).toBe(false);
	});

	it("rejects a body with a different top-level error string", () => {
		const body = {
			error: "MODERATION_BLOCKED",
			message: "x",
			redirect_to: "/me#email",
			dialog: { title: "x", body: "y", cta_label: "z" },
		};
		expect(isEmailNotVerifiedPayloadClient(body)).toBe(false);
	});

	it("rejects when redirect_to is missing", () => {
		const body = {
			error: "EMAIL_NOT_VERIFIED",
			message: "x",
			dialog: { title: "x", body: "y", cta_label: "z" },
		};
		expect(isEmailNotVerifiedPayloadClient(body)).toBe(false);
	});

	it("rejects when dialog is missing", () => {
		const body = {
			error: "EMAIL_NOT_VERIFIED",
			message: "x",
			redirect_to: "/me#email",
		};
		expect(isEmailNotVerifiedPayloadClient(body)).toBe(false);
	});

	it("rejects when dialog is missing required fields", () => {
		const body = {
			error: "EMAIL_NOT_VERIFIED",
			message: "x",
			redirect_to: "/me#email",
			dialog: { title: "x" }, // missing body, cta_label
		};
		expect(isEmailNotVerifiedPayloadClient(body)).toBe(false);
	});

	it("rejects when message is not a string", () => {
		const body = {
			error: "EMAIL_NOT_VERIFIED",
			message: 42,
			redirect_to: "/me#email",
			dialog: { title: "x", body: "y", cta_label: "z" },
		};
		expect(isEmailNotVerifiedPayloadClient(body)).toBe(false);
	});
});

describe("pickDialogPayload", () => {
	it("returns the wire body when it matches §5.4", () => {
		const wire = {
			error: "EMAIL_NOT_VERIFIED",
			message: "请先验证",
			redirect_to: "/me#email?from=write",
			dialog: { title: "标题", body: "正文", cta_label: "去验证", cta_variant: "primary" },
		};
		const out = pickDialogPayload(wire);
		expect(out.redirect_to).toBe("/me#email?from=write");
		expect(out.dialog.title).toBe("标题");
		expect(out.dialog.body).toBe("正文");
		expect(out.dialog.cta_label).toBe("去验证");
	});

	it("clones the wire dialog so mutating the result doesn't affect the wire body", () => {
		const wire = {
			error: "EMAIL_NOT_VERIFIED",
			message: "x",
			redirect_to: "/me#email",
			dialog: { title: "t", body: "b", cta_label: "c", cta_variant: "primary" },
		};
		const out = pickDialogPayload(wire);
		expect(out.dialog).not.toBe(wire.dialog);
	});

	it("falls back to the canonical constant when body is not §5.4", () => {
		const out = pickDialogPayload(undefined);
		expect(out.redirect_to).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to);
		expect(out.dialog.title).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.title);
		expect(out.dialog.body).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.body);
		expect(out.dialog.cta_label).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.cta_label);
	});

	it("clones the constant so the canonical EMAIL_NOT_VERIFIED_PAYLOAD is not aliased", () => {
		const out = pickDialogPayload(undefined);
		expect(out.dialog).not.toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog);
	});

	it("falls back when the wire body is wrapped (the malformed-shape regression)", () => {
		const wrapped = {
			error: { code: "EMAIL_NOT_VERIFIED", message: "x" },
		};
		const out = pickDialogPayload(wrapped);
		expect(out.dialog.title).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.title);
	});
});

describe("dispatchEmailNotVerified", () => {
	const originalWindow = (globalThis as { window?: unknown }).window;

	afterEach(() => {
		// Restore whatever was (or wasn't) on globalThis.window. The vitest
		// env is "node" so by default `window` is undefined; we put it back
		// to undefined after browser-stubbed tests.
		if (originalWindow === undefined) {
			(globalThis as { window?: unknown }).window = undefined;
		} else {
			(globalThis as { window?: unknown }).window = originalWindow;
		}
	});

	it("returns false on the server (no window)", () => {
		// node env — no window stubbed.
		expect((globalThis as { window?: unknown }).window).toBeUndefined();
		const out = dispatchEmailNotVerified({
			dialog: { ...EMAIL_NOT_VERIFIED_PAYLOAD.dialog },
			redirect_to: "/me#email",
		});
		expect(out).toBe(false);
	});

	it("dispatches a CustomEvent with the correct name and detail in the browser", () => {
		const dispatchSpy = vi.fn();
		(globalThis as { window?: unknown }).window = {
			dispatchEvent: dispatchSpy,
		};
		const detail = {
			dialog: { title: "T", body: "B", cta_label: "L", cta_variant: "primary" as const },
			redirect_to: "/me#email?phase=7",
		};
		const out = dispatchEmailNotVerified(detail);
		expect(out).toBe(true);
		expect(dispatchSpy).toHaveBeenCalledTimes(1);
		const evt = dispatchSpy.mock.calls[0][0] as CustomEvent;
		expect(evt.type).toBe(EMAIL_NOT_VERIFIED_EVENT);
		expect(evt.detail).toEqual(detail);
	});
});

describe("normalizeCtaVariant", () => {
	// Reviewer mandate (msg 5b4f107f): missing / unknown cta_variant must
	// fall back to "primary" so Button never receives undefined.
	it("returns 'primary' when input is undefined", () => {
		expect(normalizeCtaVariant(undefined)).toBe("primary");
	});

	it("passes through 'primary' verbatim", () => {
		expect(normalizeCtaVariant("primary")).toBe("primary");
	});

	it("falls back to 'primary' for unknown variants (forward-compat with future schema bumps)", () => {
		// The current EmailNotVerifiedCtaVariant union is just "primary",
		// so a wire body that ships a new variant we haven't taught the
		// renderer about should NOT be passed through. Cast through unknown
		// to simulate a wire body the type system hasn't caught up to.
		expect(normalizeCtaVariant("danger" as unknown as "primary")).toBe("primary");
		expect(normalizeCtaVariant("" as unknown as "primary")).toBe("primary");
	});
});

describe("preflightEmailVerifiedBlock", () => {
	// Reviewer guidance (msg 58c38e78): "只在能可靠知道 emailVerifiedAt === 0
	// 的入口做 preflight dispatch；不知道状态的入口不要猜。" — null and
	// undefined fall through to the api-client backstop; only literal `0`
	// blocks. Verified users (positive numbers) proceed normally.
	const originalWindow = (globalThis as { window?: unknown }).window;

	afterEach(() => {
		if (originalWindow === undefined) {
			(globalThis as { window?: unknown }).window = undefined;
		} else {
			(globalThis as { window?: unknown }).window = originalWindow;
		}
	});

	it("returns false for null without dispatching (anonymous / fail-soft)", () => {
		const dispatchSpy = vi.fn();
		(globalThis as { window?: unknown }).window = { dispatchEvent: dispatchSpy };
		expect(preflightEmailVerifiedBlock(null)).toBe(false);
		expect(dispatchSpy).not.toHaveBeenCalled();
	});

	it("returns false for undefined without dispatching (caller has no source)", () => {
		const dispatchSpy = vi.fn();
		(globalThis as { window?: unknown }).window = { dispatchEvent: dispatchSpy };
		expect(preflightEmailVerifiedBlock(undefined)).toBe(false);
		expect(dispatchSpy).not.toHaveBeenCalled();
	});

	it("returns true and dispatches the canonical payload for 0 (unverified)", () => {
		const dispatchSpy = vi.fn();
		(globalThis as { window?: unknown }).window = { dispatchEvent: dispatchSpy };
		expect(preflightEmailVerifiedBlock(0)).toBe(true);
		expect(dispatchSpy).toHaveBeenCalledTimes(1);
		const evt = dispatchSpy.mock.calls[0][0] as CustomEvent;
		expect(evt.type).toBe(EMAIL_NOT_VERIFIED_EVENT);
		// Preflight has no wire body, so the canonical constant is dispatched.
		expect((evt.detail as { dialog: { title: string } }).dialog.title).toBeTruthy();
	});

	it("returns false for a positive timestamp without dispatching (verified)", () => {
		const dispatchSpy = vi.fn();
		(globalThis as { window?: unknown }).window = { dispatchEvent: dispatchSpy };
		expect(preflightEmailVerifiedBlock(1_700_000_000_000)).toBe(false);
		expect(dispatchSpy).not.toHaveBeenCalled();
	});
});
