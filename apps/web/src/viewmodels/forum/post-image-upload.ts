/**
 * Post-image upload — parser for `/api/v1/upload` (purpose=post-image)
 * response bodies. Mirrors the avatar-upload parser shape so the editor
 * uses the same discriminated-union pattern (success / §5.4 EMAIL_NOT_VERIFIED
 * / wrapped error).
 *
 * Why a dedicated parser: the post-editor uploads via raw `fetch` (not
 * `apiClient`), so the global §5.4 dispatch interceptor doesn't fire.
 * Detect the flat `{ error: "EMAIL_NOT_VERIFIED", ... }` payload here so
 * the verification dialog can be triggered explicitly by the caller.
 *
 * Pure: no fetch, no React, no DOM.
 */

import {
	type EmailNotVerifiedEventDetail,
	isEmailNotVerifiedPayloadClient,
	pickDialogPayload,
} from "@/viewmodels/forum/email-not-verified-dispatch";

export type PostImageUploadResult =
	| { kind: "success"; url: string; size: number; contentType: string }
	| { kind: "email-not-verified"; detail: EmailNotVerifiedEventDetail }
	| { kind: "error"; message: string };

const FALLBACK_ERROR_MESSAGE = "上传失败";

/**
 * Parse the upload proxy response into a discriminated union.
 *
 * Detection order:
 *   1. §5.4 flat payload (must precede wrapped-error path)
 *   2. 2xx with `data.url` + `data.size` + `data.contentType` → success
 *   3. 2xx without a usable shape → fallback error
 *   4. Non-2xx with wrapped `error.message` → surface message
 *   5. Anything else → fallback
 */
export function parsePostImageUploadResponse(status: number, body: unknown): PostImageUploadResult {
	if (isEmailNotVerifiedPayloadClient(body)) {
		return { kind: "email-not-verified", detail: pickDialogPayload(body) };
	}

	const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

	if (status >= 200 && status < 300) {
		const data = obj?.data;
		if (data && typeof data === "object") {
			const d = data as Record<string, unknown>;
			if (
				typeof d.url === "string" &&
				typeof d.size === "number" &&
				typeof d.contentType === "string"
			) {
				return { kind: "success", url: d.url, size: d.size, contentType: d.contentType };
			}
		}
		return { kind: "error", message: FALLBACK_ERROR_MESSAGE };
	}

	const error = obj?.error;
	if (error && typeof error === "object") {
		const e = error as Record<string, unknown>;
		if (typeof e.message === "string" && e.message.length > 0) {
			return { kind: "error", message: e.message };
		}
		// Fall through to wrap details.message if present
		const details = e.details;
		if (details && typeof details === "object") {
			const dm = (details as Record<string, unknown>).message;
			if (typeof dm === "string" && dm.length > 0) {
				return { kind: "error", message: dm };
			}
		}
	}

	return { kind: "error", message: FALLBACK_ERROR_MESSAGE };
}
