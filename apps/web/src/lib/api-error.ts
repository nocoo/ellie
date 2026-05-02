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
	/**
	 * Raw response body parsed as JSON (when available). Lets proxy/error
	 * helpers forward unusual shapes verbatim — notably the flat
	 * `{ error: "EMAIL_NOT_VERIFIED", message, dialog, redirect_to }` payload
	 * from docs/17 §5.4, which would otherwise be lossily collapsed into
	 * `{ error: { code, message } }`. Optional and best-effort: clients that
	 * don't capture it will still see `code` populated.
	 */
	rawBody?: unknown;

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
