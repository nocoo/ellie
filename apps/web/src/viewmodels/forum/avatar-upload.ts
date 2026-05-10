/**
 * Avatar upload — parser for `/api/v1/upload` response bodies.
 *
 * After Phase A the upload itself goes through `apiClient.upload`
 * (browser facade `uploadAvatar` in `lib/forum-browser-api`), and the
 * §5.4 EMAIL_NOT_VERIFIED dispatch happens centrally inside
 * `apiClient`'s shared `throwForErrorBody`. This parser still classifies
 * outcome shapes for the component's UI (success / email-not-verified /
 * error) so the call site can render inline copy and toast without
 * caring about transport details.
 *
 * This module is intentionally pure: no `fetch`, no React, no DOM. The
 * facade calls `parseAvatarUploadResponse(status, json)` after
 * `apiClient.upload` resolves or throws, and the component acts on the
 * discriminated result. Tests pin the four cases (success, wrapped
 * error, flat §5.4, malformed body) without needing to mount anything.
 */

import {
	type EmailNotVerifiedEventDetail,
	isEmailNotVerifiedPayloadClient,
	pickDialogPayload,
} from "@/viewmodels/forum/email-not-verified-dispatch";

export type AvatarUploadResult =
	| { kind: "success"; url: string; size: number }
	| { kind: "email-not-verified"; detail: EmailNotVerifiedEventDetail }
	| { kind: "error"; message: string };

const FALLBACK_ERROR_MESSAGE = "上传失败";

/**
 * Parse the upload proxy response into a discriminated union.
 *
 * Detection order matters:
 *   1. §5.4 flat payload — must be checked BEFORE the wrapped error path,
 *      because its top-level `error` is a string discriminator, not the
 *      `{ code, message }` object the wrapped path expects.
 *   2. 2xx with `data.url` + `data.size` — success.
 *   3. 2xx without a usable `data` shape — treat as error (the upload
 *      didn't actually deliver a URL we can show the user).
 *   4. Non-2xx with wrapped `error.message` — surface the message.
 *   5. Anything else — generic fallback string.
 */
export function parseAvatarUploadResponse(status: number, body: unknown): AvatarUploadResult {
	if (isEmailNotVerifiedPayloadClient(body)) {
		return { kind: "email-not-verified", detail: pickDialogPayload(body) };
	}

	const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : null;

	if (status >= 200 && status < 300) {
		const data = obj?.data;
		if (data && typeof data === "object") {
			const d = data as Record<string, unknown>;
			if (typeof d.url === "string" && typeof d.size === "number") {
				return { kind: "success", url: d.url, size: d.size };
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
	}

	return { kind: "error", message: FALLBACK_ERROR_MESSAGE };
}
