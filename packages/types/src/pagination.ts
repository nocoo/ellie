// models/pagination.ts — Keyset cursor encode/decode utilities
// Ref: 04a §Repository interfaces — cursor is opaque base64(JSON({ sortValue, id }))

/** Cursor payload — the actual data encoded inside a cursor string */
export interface CursorPayload {
	sortValue: number;
	id: number;
}

/**
 * Encode a cursor payload into an opaque string.
 * Format: base64(JSON({ sortValue, id }))
 */
export function encodeCursor(payload: CursorPayload): string {
	return btoa(JSON.stringify(payload));
}

/**
 * Decode an opaque cursor string back into a payload.
 * Returns null if the cursor is invalid.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
	try {
		const json = atob(cursor);
		const parsed: unknown = JSON.parse(json);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"sortValue" in parsed &&
			"id" in parsed &&
			typeof (parsed as CursorPayload).sortValue === "number" &&
			typeof (parsed as CursorPayload).id === "number"
		) {
			return parsed as CursorPayload;
		}
		return null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Generic cursor utilities for various payload shapes
// ---------------------------------------------------------------------------

/**
 * Encode any cursor payload object into an opaque base64 string.
 * This is the generic version that works with any payload shape.
 */
export function encodeGenericCursor<T extends object>(payload: T): string {
	return btoa(JSON.stringify(payload));
}

/**
 * Decode an opaque cursor string and validate it against a schema.
 *
 * @param cursor - The base64-encoded cursor string
 * @param validator - A function that validates the parsed object has the expected shape
 * @returns The validated payload or null if invalid
 *
 * @example
 * ```ts
 * interface PostCursor { position: number }
 * const payload = decodeGenericCursor<PostCursor>(cursor, (p) =>
 *   typeof p.position === 'number'
 * );
 * ```
 */
export function decodeGenericCursor<T extends object>(
	cursor: string,
	validator: (parsed: Partial<T>) => boolean,
): T | null {
	try {
		const json = atob(cursor);
		const parsed: unknown = JSON.parse(json);
		if (typeof parsed !== "object" || parsed === null) {
			return null;
		}
		if (validator(parsed as Partial<T>)) {
			return parsed as T;
		}
		return null;
	} catch {
		return null;
	}
}

/** Default page size */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum page size */
export const MAX_PAGE_SIZE = 50;

/** Clamp a requested limit to valid range [1, MAX_PAGE_SIZE], defaulting to DEFAULT_PAGE_SIZE */
export function clampPageSize(limit?: number): number {
	if (limit === undefined || limit <= 0) return DEFAULT_PAGE_SIZE;
	return Math.min(limit, MAX_PAGE_SIZE);
}
