// Behavioral tests for the post-image upload response parser.
//
// Mirrors avatar-upload.test.ts. The post-editor uploads via raw
// multipart `fetch` (not `apiClient`), so the §5.4 flat
// `EMAIL_NOT_VERIFIED` payload must be detected at the parser layer so
// the editor can dispatch the global verification dialog instead of
// silently surfacing "上传失败".

import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { describe, expect, it } from "vitest";
import { parsePostImageUploadResponse } from "@/viewmodels/forum/post-image-upload";

describe("parsePostImageUploadResponse", () => {
	it("returns success for 2xx with data.url + data.size + data.contentType", () => {
		const result = parsePostImageUploadResponse(200, {
			data: {
				url: "/api/post-image/550e8400-e29b-41d4-a716-446655440000.jpg",
				size: 12345,
				contentType: "image/jpeg",
			},
			meta: { timestamp: 1, requestId: "r1" },
		});
		expect(result).toEqual({
			kind: "success",
			url: "/api/post-image/550e8400-e29b-41d4-a716-446655440000.jpg",
			size: 12345,
			contentType: "image/jpeg",
		});
	});

	it("returns error for 2xx without a usable data shape (missing contentType)", () => {
		const result = parsePostImageUploadResponse(200, {
			data: { url: "/foo.jpg", size: 100 },
		});
		expect(result.kind).toBe("error");
	});

	it("returns error for 2xx with empty data", () => {
		const result = parsePostImageUploadResponse(200, { data: {} });
		expect(result.kind).toBe("error");
	});

	it("returns email-not-verified for the §5.4 flat payload (403)", () => {
		const result = parsePostImageUploadResponse(403, EMAIL_NOT_VERIFIED_PAYLOAD);
		expect(result.kind).toBe("email-not-verified");
		if (result.kind !== "email-not-verified") throw new Error("unreachable");
		expect(result.detail.redirect_to).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to);
		expect(result.detail.dialog.title).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.title);
	});

	it("recognizes the §5.4 payload even when status is 200 (defense in depth)", () => {
		const result = parsePostImageUploadResponse(200, EMAIL_NOT_VERIFIED_PAYLOAD);
		expect(result.kind).toBe("email-not-verified");
	});

	it("forwards wrapped error.message on non-2xx", () => {
		const result = parsePostImageUploadResponse(413, {
			error: { code: "FILE_TOO_LARGE", message: "图片太大" },
		});
		expect(result).toEqual({ kind: "error", message: "图片太大" });
	});

	it("forwards wrapped error.details.message when error.message is missing", () => {
		const result = parsePostImageUploadResponse(415, {
			error: {
				code: "INVALID_FORMAT",
				details: { message: "Only JPEG/PNG/WebP/GIF allowed" },
			},
		});
		expect(result).toEqual({
			kind: "error",
			message: "Only JPEG/PNG/WebP/GIF allowed",
		});
	});

	it("falls back to generic message when wrapped error has no usable message", () => {
		const result = parsePostImageUploadResponse(500, { error: { code: "BOOM" } });
		expect(result.kind).toBe("error");
		if (result.kind !== "error") throw new Error("unreachable");
		expect(result.message.length).toBeGreaterThan(0);
	});

	it("falls back to generic message for malformed body (null / non-object)", () => {
		expect(parsePostImageUploadResponse(500, null).kind).toBe("error");
		expect(parsePostImageUploadResponse(500, "garbage").kind).toBe("error");
		expect(parsePostImageUploadResponse(500, undefined).kind).toBe("error");
	});

	it("does NOT misclassify a wrapped error with code=EMAIL_NOT_VERIFIED as the flat payload", () => {
		const result = parsePostImageUploadResponse(403, {
			error: { code: "EMAIL_NOT_VERIFIED", message: "verify first" },
		});
		expect(result).toEqual({ kind: "error", message: "verify first" });
	});
});
