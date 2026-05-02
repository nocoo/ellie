// Error handling middleware for Cloudflare Worker

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
	};

	return messages[code] || "An error occurred";
}
