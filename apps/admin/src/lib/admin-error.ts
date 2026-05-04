// admin-error.ts — Helpers for surfacing failed admin mutations to the UI.
//
// All admin viewmodel handlers can route caught errors through `extractErrorMessage`
// to produce a single human-readable string suitable for AdminInlineMessage banners
// or dialog inline error slots. Worker `details` are intentionally NOT mapped to
// per-field UI in this batch — we only surface the top-level message.

import { ApiError } from "@ellie/shared";

/**
 * Convert any thrown value into a user-facing message string.
 *
 * Order:
 * 1. ApiError → `.message` (the worker's human message; falls back to code).
 * 2. Native Error → `.message`.
 * 3. Anything else → fallback string.
 *
 * @param err     The caught value (typically from a try/catch on a mutation).
 * @param fallback The default message if `err` carries no usable text.
 */
export function extractErrorMessage(err: unknown, fallback = "操作失败，请稍后重试"): string {
	if (err instanceof ApiError) {
		// ApiError.message is set from the structured `data.message` (or flat code/message).
		// If it ever ends up empty, fall back to the code so the user sees something.
		return err.message || err.code || fallback;
	}
	if (err instanceof Error) {
		return err.message || fallback;
	}
	return fallback;
}
