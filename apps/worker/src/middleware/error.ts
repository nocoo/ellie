// Error handling middleware for Cloudflare Worker

import { cloneEmailNotVerifiedPayload } from "@ellie/types";
import { corsHeaders } from "./cors";

export interface ErrorResponse {
	error: {
		code: string;
		message: string;
		details?: Record<string, unknown>;
	};
}

export function errorResponse(
	code: string,
	status: number,
	details?: Record<string, unknown>,
	origin?: string,
): Response {
	const body: ErrorResponse = {
		error: {
			code,
			message: getStatusMessage(code),
			...(details && { details }),
		},
	};

	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(origin),
			"Content-Type": "application/json",
		},
	});
}

/**
 * Build the canonical 403 response for the email-verification gate
 * (docs/17 §5.4 — Rev4). The body shape is the FLAT EmailNotVerifiedPayload
 * exported from `@ellie/types` (NOT the wrapped `{ error: { code, message } }`
 * shape used by {@link errorResponse}). Frontend dispatches dialogs by
 * string-equal on the top-level `error` field — do not regress this.
 *
 * Always uses `cloneEmailNotVerifiedPayload()` to avoid sharing the constant
 * by reference with the JSON serializer.
 */
export function emailNotVerifiedResponse(origin?: string): Response {
	return new Response(JSON.stringify(cloneEmailNotVerifiedPayload()), {
		status: 403,
		headers: {
			...corsHeaders(origin),
			"Content-Type": "application/json",
		},
	});
}

function getStatusMessage(code: string): string {
	const messages: Record<string, string> = {
		INVALID_REQUEST: "Invalid request parameters",
		UNAUTHORIZED: "Authentication required",
		FORBIDDEN: "Access denied",
		NOT_FOUND: "Resource not found",
		RATE_LIMITED: "Too many requests, please try again later",
		INTERNAL_ERROR: "Internal server error",
		INVALID_CREDENTIALS: "Invalid username or password",
		INVALID_USERNAME: "Username format is invalid",
		INVALID_PASSWORD: "Password must be at least 6 characters",
		INVALID_EMAIL: "Email format is invalid",
		USERNAME_BANNED: "Username contains prohibited words",
		USER_BANNED: "User account is banned",
		EMAIL_NOT_VERIFIED: "Email verification required to perform this action",
		EMAIL_ALREADY_VERIFIED: "Email is already verified",
		EMAIL_INVALID: "Email format is invalid or empty",
		CODE_FORMAT_INVALID: "Verification code must be 6 digits",
		CODE_NOT_FOUND: "No verification code found — request a new one",
		CODE_INVALID: "Verification code is incorrect",
		CODE_LOCKED: "Too many incorrect attempts — request a new code",
		CODE_RESEND_THROTTLED: "Please wait before requesting another code",
		EMAIL_CODE_EMAIL_MISMATCH:
			"Submitted email does not match the address the code was sent to — request a new code",
		EMAIL_ALREADY_IN_USE: "Email address is already in use",
		EMAIL_CORRECTION_USED:
			"Email has already been corrected once — only one correction is allowed before verification",
		EMAIL_NOT_CORRECTABLE: "Email is already verified — corrections are no longer allowed",
		EMAIL_UNCHANGED: "New email is the same as the current email — nothing to correct",
		EMAIL_PROVIDER_FAILED: "Failed to send verification email — please try again",
		CAPTCHA_REQUIRED: "Captcha verification is required",
		CAPTCHA_INVALID: "Captcha verification failed — please refresh and try again",
		TOKEN_EXPIRED: "Authentication token has expired",
		INVALID_TOKEN: "Invalid authentication token",
		FORBIDDEN_ADMIN_ONLY: "This action requires administrator privileges",
		FORBIDDEN_MOD_ONLY: "This action requires moderator privileges",
		INVALID_BODY: "Request body is invalid or missing required fields",
		FORUM_NOT_FOUND: "Forum not found",
		FORUM_HAS_THREADS: "Cannot delete forum that contains threads",
		THREAD_TYPE_NOT_FOUND: "Thread type not found",
		THREAD_TYPE_DUPLICATE_SOURCE_TYPEID:
			"A thread type with this sourceTypeid already exists in this forum",
		THREAD_TYPE_REQUIRED_NEEDS_ENABLED: "thread_types_required=1 requires thread_types_enabled=1",
		THREAD_TYPE_FORUM_MISMATCH: "Thread type does not belong to this forum",
		BATCH_LIMIT_EXCEEDED: "Batch operation exceeds maximum size",
		SELF_BAN: "Cannot ban yourself",
		SELF_ROLE_CHANGE: "Cannot change your own role",
		CANNOT_DELETE_FIRST_POST: "Cannot delete the first post — delete the thread instead",
		INVALID_REFRESH_TOKEN: "Refresh token is invalid or expired",
		THREAD_NOT_FOUND: "Thread not found",
		THREAD_CLOSED: "Thread is closed and does not accept new replies",
		POST_NOT_FOUND: "Post not found",
		USER_NOT_FOUND: "User not found",
		WRONG_PASSWORD: "Current password is incorrect",
		USERNAME_TAKEN: "Username is already taken",
		IP_BAN_NOT_FOUND: "IP ban record not found",
		IP_BAN_DUPLICATE: "IP ban record already exists for this IP",
		IP_BAN_SELF: "Cannot ban your own IP",
		CENSOR_WORD_NOT_FOUND: "Censor word rule not found",
		CENSOR_WORD_DUPLICATE: "Censor word rule already exists",
		CENSOR_WORD_INVALID: "Censor word rule is invalid (too short or bad regex syntax)",
		CONTENT_BANNED: "Content contains banned words",
		INVALID_JSON: "Request body is not valid JSON",
		EMPTY_PAYLOAD: "Request body must contain at least one entry",
		UNKNOWN_KEYS: "Request contains unrecognized setting keys",
		INVALID_NUMBER: "Numeric setting value must be a positive number",
		MAINTENANCE_MODE: "Site is under maintenance",
		FEATURE_DISABLED: "Feature is currently disabled",
		// Upload errors
		NO_FILE: "No file provided in request",
		INVALID_PURPOSE: "Unknown upload purpose",
		FILE_TOO_LARGE: "File size exceeds the allowed limit",
		INVALID_FORMAT: "File format is not allowed",
		UPLOAD_FAILED: "Failed to upload file",
		// Check-in errors
		CHECKIN_INVALID_MOOD: "Invalid mood — must be one of the predefined emotion codes",
		CHECKIN_OUTSIDE_WINDOW: "Check-in is not available at this time",
		CHECKIN_ALREADY_DONE: "Already checked in today",
		// Post rating (评分) errors — docs/22-post-rating.md §6.2
		RATING_PERMISSION_DENIED: "Your role cannot rate this dimension",
		RATING_SELF: "You cannot rate your own post",
		RATING_INVALID_POST: "This post cannot be rated",
		RATING_DUPLICATE: "You have already rated this post in this dimension",
		RATING_DAILY_LIMIT: "Daily rating quota has been exhausted",
		RATING_SCORE_OUT_OF_RANGE: "Rating score is out of the allowed range",
		RATING_REASON_TOO_LONG: "Rating reason is too long",
	};

	return messages[code] || "An error occurred";
}
