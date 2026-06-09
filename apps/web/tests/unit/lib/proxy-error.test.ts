// Tests for proxy-error helper (apps/web/src/lib/proxy-error.ts).
//
// The proxy layer must NOT collapse the docs/17 §5.4 EmailNotVerifiedPayload
// into the wrapped `{ error: { code, message } }` shape — the web fetch
// wrapper dispatches the verification dialog by string-equal on top-level
// `error`. This test pair locks both behaviours: §5.4 forwards verbatim,
// every other ForumApiError gets the wrapped shape.

import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { describe, expect, it } from "vitest";
import { ForumApiError } from "@/lib/forum-api";
import { forumApiErrorToProxyResponse, isEmailNotVerifiedPayload } from "@/lib/proxy-error";

describe("isEmailNotVerifiedPayload — §5.4 discriminator", () => {
	it("returns true for the canonical payload", () => {
		expect(isEmailNotVerifiedPayload(EMAIL_NOT_VERIFIED_PAYLOAD)).toBe(true);
	});

	it("returns true for any object with the §5.4 fingerprint (error/message/dialog/redirect_to)", () => {
		expect(
			isEmailNotVerifiedPayload({
				error: "EMAIL_NOT_VERIFIED",
				message: "Email not verified",
				dialog: { title: "x", body: "y", primary_action: { label: "z", href: "/me" } },
				redirect_to: "/verify-email",
				extra: 1,
			}),
		).toBe(true);
	});

	it("returns false when top-level error matches but fingerprint fields are missing", () => {
		// Reviewer hardening: top-level discriminator alone is not enough.
		expect(isEmailNotVerifiedPayload({ error: "EMAIL_NOT_VERIFIED" })).toBe(false);
		expect(isEmailNotVerifiedPayload({ error: "EMAIL_NOT_VERIFIED", message: "x" })).toBe(false);
		expect(
			isEmailNotVerifiedPayload({
				error: "EMAIL_NOT_VERIFIED",
				message: "x",
				redirect_to: "/y",
				// dialog missing
			}),
		).toBe(false);
		expect(
			isEmailNotVerifiedPayload({
				error: "EMAIL_NOT_VERIFIED",
				message: "x",
				dialog: { title: "t" },
				// redirect_to missing
			}),
		).toBe(false);
	});

	it("returns false for the wrapped { error: { code } } shape", () => {
		expect(
			isEmailNotVerifiedPayload({
				error: { code: "EMAIL_NOT_VERIFIED", message: "x" },
			}),
		).toBe(false);
	});

	it("returns false for null / undefined / non-objects", () => {
		expect(isEmailNotVerifiedPayload(null)).toBe(false);
		expect(isEmailNotVerifiedPayload(undefined)).toBe(false);
		expect(isEmailNotVerifiedPayload("EMAIL_NOT_VERIFIED")).toBe(false);
		expect(isEmailNotVerifiedPayload(403)).toBe(false);
	});
});

describe("forumApiErrorToProxyResponse", () => {
	it("forwards the §5.4 flat payload verbatim with the original status", async () => {
		const err = new ForumApiError(403, {
			code: "EMAIL_NOT_VERIFIED",
			message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		});
		// Simulate what forum-api.request() captures from a flat-payload Worker
		// response — the raw JSON body the Worker actually sent.
		err.rawBody = EMAIL_NOT_VERIFIED_PAYLOAD;
		const res = forumApiErrorToProxyResponse(err);
		expect(res.status).toBe(403);
		const body = await res.json();
		// Must be the flat shape — top-level `error` is the literal string,
		// `dialog` and `redirect_to` are intact. NOT wrapped under `error.code`.
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("collapses every other ForumApiError into the wrapped { error: { code, message } } shape", async () => {
		const err = new ForumApiError(429, {
			code: "CODE_RESEND_THROTTLED",
			message: "Too soon",
		});
		err.rawBody = {
			error: { code: "CODE_RESEND_THROTTLED", message: "Too soon" },
			details: { next_resend_allowed_at: 1700000060 },
		};
		const res = forumApiErrorToProxyResponse(err);
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({
			error: { code: "CODE_RESEND_THROTTLED", message: "Too soon" },
		});
	});

	it("falls back to wrapped shape when rawBody was never captured", async () => {
		const err = new ForumApiError(500, { code: "INTERNAL_ERROR", message: "boom" });
		const res = forumApiErrorToProxyResponse(err);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "boom" } });
	});

	it("preserves details field from Worker error (D1/runtime diagnostics)", async () => {
		const err = new ForumApiError(500, {
			code: "INTERNAL_ERROR",
			message: "Internal server error",
			details: { message: "D1_ERROR: too many SQL variables" },
		});
		const res = forumApiErrorToProxyResponse(err);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toEqual({
			error: {
				code: "INTERNAL_ERROR",
				message: "Internal server error",
				details: { message: "D1_ERROR: too many SQL variables" },
			},
		});
	});

	it("omits details when not present on ForumApiError", async () => {
		const err = new ForumApiError(404, { code: "NOT_FOUND", message: "Resource not found" });
		const res = forumApiErrorToProxyResponse(err);
		const body = await res.json();
		expect(body.error.details).toBeUndefined();
		expect(body).toEqual({ error: { code: "NOT_FOUND", message: "Resource not found" } });
	});
});
