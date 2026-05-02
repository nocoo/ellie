// Behavioral tests for the avatar-upload response parser (R2-B).
//
// The avatar uploader uses raw multipart fetch, which bypasses
// `apiClient`'s email-verification interceptor. The parser is the seam
// where the §5.4 flat payload is recognized so the component can dispatch
// the global dialog instead of silently rendering "上传失败".

import { parseAvatarUploadResponse } from "@/viewmodels/forum/avatar-upload";
import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { describe, expect, it } from "vitest";

describe("parseAvatarUploadResponse", () => {
	it("returns success for 2xx with data.url + data.size", () => {
		const result = parseAvatarUploadResponse(200, {
			data: { url: "https://cdn.example.com/avatar.png", size: 12345 },
			meta: { timestamp: 1, requestId: "r1" },
		});
		expect(result).toEqual({
			kind: "success",
			url: "https://cdn.example.com/avatar.png",
			size: 12345,
		});
	});

	it("returns error for 2xx without a usable data shape", () => {
		// Worker accepted the request but didn't deliver a URL we can show.
		const result = parseAvatarUploadResponse(200, { data: {} });
		expect(result.kind).toBe("error");
	});

	it("returns email-not-verified for the §5.4 flat payload (403)", () => {
		const result = parseAvatarUploadResponse(403, EMAIL_NOT_VERIFIED_PAYLOAD);
		expect(result.kind).toBe("email-not-verified");
		if (result.kind !== "email-not-verified") throw new Error("unreachable");
		expect(result.detail.redirect_to).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to);
		expect(result.detail.dialog.title).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.title);
	});

	it("recognizes the §5.4 payload even when status is 200 (defense in depth)", () => {
		// Should never happen on the wire, but the discriminator is the body
		// shape, not the status code — the dialog must still open.
		const result = parseAvatarUploadResponse(200, EMAIL_NOT_VERIFIED_PAYLOAD);
		expect(result.kind).toBe("email-not-verified");
	});

	it("forwards wrapped error.message on non-2xx", () => {
		const result = parseAvatarUploadResponse(413, {
			error: { code: "FILE_TOO_LARGE", message: "图片太大" },
		});
		expect(result).toEqual({ kind: "error", message: "图片太大" });
	});

	it("falls back to generic message when wrapped error has no message", () => {
		const result = parseAvatarUploadResponse(500, { error: { code: "BOOM" } });
		expect(result.kind).toBe("error");
		if (result.kind !== "error") throw new Error("unreachable");
		expect(result.message.length).toBeGreaterThan(0);
	});

	it("falls back to generic message for malformed body (null / non-object)", () => {
		expect(parseAvatarUploadResponse(500, null).kind).toBe("error");
		expect(parseAvatarUploadResponse(500, "garbage").kind).toBe("error");
		expect(parseAvatarUploadResponse(500, undefined).kind).toBe("error");
	});

	it("does NOT misclassify a wrapped error with code=EMAIL_NOT_VERIFIED as the flat payload", () => {
		// The wrapped shape `{ error: { code: "EMAIL_NOT_VERIFIED", message } }`
		// is NOT the §5.4 dispatchable payload — it lacks `dialog` /
		// `redirect_to`. Treat it as a normal error so the dialog is not
		// triggered with empty copy.
		const result = parseAvatarUploadResponse(403, {
			error: { code: "EMAIL_NOT_VERIFIED", message: "verify first" },
		});
		expect(result).toEqual({ kind: "error", message: "verify first" });
	});
});
