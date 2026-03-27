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
		USER_BANNED: "User account is banned",
		TOKEN_EXPIRED: "Authentication token has expired",
		INVALID_TOKEN: "Invalid authentication token",
		FORBIDDEN_ADMIN_ONLY: "This action requires administrator privileges",
		FORBIDDEN_MOD_ONLY: "This action requires moderator privileges",
		INVALID_BODY: "Request body is invalid or missing required fields",
		FORUM_HAS_THREADS: "Cannot delete forum that contains threads",
		BATCH_LIMIT_EXCEEDED: "Batch operation exceeds maximum size",
		SELF_BAN: "Cannot ban yourself",
		SELF_ROLE_CHANGE: "Cannot change your own role",
		CANNOT_DELETE_FIRST_POST: "Cannot delete the first post — delete the thread instead",
	};

	return messages[code] || "An error occurred";
}
