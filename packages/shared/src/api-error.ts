// lib/api-error.ts — Unified API error base class
// Single source of truth for HTTP API errors across all API clients.

// ---------------------------------------------------------------------------
// Error data shape (used by structured constructors)
// ---------------------------------------------------------------------------

/** Standard error payload returned by the Worker API. */
export interface ApiErrorData {
	code: string;
	message: string;
	details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Base error class
// ---------------------------------------------------------------------------

/**
 * Unified API error thrown by all HTTP API clients.
 *
 * Supports two construction patterns:
 * 1. Structured: `new ApiError(status, { code, message, details? })`
 * 2. Flat: `new ApiError(status, code, message)`
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details?: Record<string, unknown>;

	constructor(status: number, data: ApiErrorData);
	constructor(status: number, code: string, message: string);
	constructor(status: number, dataOrCode: ApiErrorData | string, message?: string) {
		if (typeof dataOrCode === "string") {
			super(message ?? dataOrCode);
			this.status = status;
			this.code = dataOrCode;
		} else {
			super(dataOrCode.message);
			this.status = status;
			this.code = dataOrCode.code;
			this.details = dataOrCode.details;
		}
		this.name = "ApiError";
	}
}
