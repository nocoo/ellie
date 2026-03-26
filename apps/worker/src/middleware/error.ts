// Error handling middleware for Cloudflare Worker

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
): Response {
	const body: ErrorResponse = {
		error: {
			code,
			message: getStatusMessage(code),
			...details && { details },
		},
	};

	return new Response(JSON.stringify(body), {
		status,
		headers: {
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
	};

	return messages[code] || "An error occurred";
}
