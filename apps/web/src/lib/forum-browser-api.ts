/**
 * Browser-side forum domain facade.
 *
 * Sits on top of `apiClient` and provides typed, intent-named methods for
 * client components / hooks. Phase A (network-layer abstraction) bans
 * client raw `fetch` — components must call these helpers instead.
 *
 * Constraints:
 *   - Client-safe: no `server-only`, no `next/headers`, no env vars.
 *   - Pure facade: never call `fetch` directly. The static guard
 *     (`tests/unit/architecture/no-raw-fetch.test.ts`) enforces this.
 *   - No new error/parser semantics here; reuse `apiClient` + the existing
 *     pure parsers in `viewmodels/forum/*-upload.ts`.
 *
 * Each helper is intentionally thin so callers can keep their existing
 * rendering / error display logic (`describeWrappedError`, parsed
 * discriminated unions) untouched.
 */

import { ApiError, type RequestOptions, apiClient } from "@/lib/api-client";
import {
	type AvatarUploadResult,
	parseAvatarUploadResponse,
} from "@/viewmodels/forum/avatar-upload";
import {
	type PostImageUploadResult,
	parsePostImageUploadResponse,
} from "@/viewmodels/forum/post-image-upload";
import type { EmailRequestCodeBody, EmailVerifyCodeBody } from "@ellie/types";

// ---------------------------------------------------------------------------
// Username availability (registration form)
// ---------------------------------------------------------------------------

export interface UsernameAvailability {
	available: boolean;
	reason?: string;
}

/**
 * `/api/auth/check-username` returns bare JSON (no envelope), so use
 * `apiClient.getRaw`. Network/parse errors collapse to the legacy
 * `{ available:false, reason:"error" }` shape so the form's debounced
 * UI logic (`UsernameStatus`) does not need to learn about ApiError.
 */
export async function checkUsernameAvailability(
	username: string,
	opts?: RequestOptions,
): Promise<UsernameAvailability> {
	try {
		return await apiClient.getRaw<UsernameAvailability>(
			"/api/auth/check-username",
			{ username },
			opts,
		);
	} catch {
		return { available: false, reason: "error" };
	}
}

// ---------------------------------------------------------------------------
// Email verification (settings card)
// ---------------------------------------------------------------------------

/**
 * Request a verification code. Throws ApiError on non-2xx so the caller can
 * call `describeWrappedError(err.rawBody, err.status)` exactly as it did
 * with raw fetch.
 */
export async function requestEmailVerificationCode(
	email: string,
): Promise<{ sent_to?: string; next_resend_allowed_at?: number } | undefined> {
	const body: EmailRequestCodeBody = { email };
	const res = await apiClient.post<{ sent_to?: string; next_resend_allowed_at?: number }>(
		"/api/v1/users/me/email/request-code",
		body,
	);
	return res.data;
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
	const body: EmailVerifyCodeBody = { email, code };
	await apiClient.post<unknown>("/api/v1/users/me/email/verify", body);
}

// ---------------------------------------------------------------------------
// File uploads (avatar, post image)
// ---------------------------------------------------------------------------

/**
 * Funnel an `apiClient.upload` outcome (success or ApiError) back through
 * the existing pure parser so the discriminated-union shape components rely
 * on (success / email-not-verified / error) does not change.
 *
 * `apiClient.upload` already dispatches the §5.4 EMAIL_NOT_VERIFIED event
 * via the shared `throwForErrorBody` path. The parser is invoked again here
 * so callers still receive the structured `kind: "email-not-verified"` so
 * they can render their inline error message.
 */
function fromUploadOutcome<T>(
	parser: (status: number, body: unknown) => T,
	outcome:
		| { ok: true; status: number; body: unknown }
		| { ok: false; status: number; body: unknown },
): T {
	return parser(outcome.status, outcome.body);
}

async function uploadFile(
	file: File,
	purpose: "avatar" | "post-image",
): Promise<{ status: number; body: unknown; ok: boolean }> {
	const formData = new FormData();
	formData.append("file", file);
	formData.append("purpose", purpose);

	try {
		const res = await apiClient.upload<unknown>("/api/v1/upload", formData);
		// Success path: rebuild the JSON envelope the parsers expect.
		return { status: 200, ok: true, body: { data: res.data, meta: res.meta } };
	} catch (err) {
		if (err instanceof ApiError) {
			return { status: err.status, ok: false, body: err.rawBody ?? null };
		}
		// Non-ApiError (network failure, fetch reject, abort) is NOT swallowed
		// here. Re-throw so the caller's existing catch branch fires with the
		// same semantics as before Phase A (raw fetch reject → component
		// catch → "上传失败，请重试").
		throw err;
	}
}

export async function uploadAvatar(file: File): Promise<AvatarUploadResult> {
	const outcome = await uploadFile(file, "avatar");
	return fromUploadOutcome(parseAvatarUploadResponse, outcome);
}

export async function uploadPostImage(file: File): Promise<PostImageUploadResult> {
	const outcome = await uploadFile(file, "post-image");
	return fromUploadOutcome(parsePostImageUploadResponse, outcome);
}

// ---------------------------------------------------------------------------
// Feature flags (useFeatureFlags hook)
// ---------------------------------------------------------------------------

export type FeatureFlagsRaw = Record<string, string | number | boolean>;

/**
 * `/api/v1/settings` returns a bare flag map (no envelope). AbortSignal
 * support is required because the hook tears down on unmount.
 */
export async function fetchFeatureFlags(opts?: RequestOptions): Promise<FeatureFlagsRaw> {
	return apiClient.getRaw<FeatureFlagsRaw>("/api/v1/settings", { prefix: "features." }, opts);
}
