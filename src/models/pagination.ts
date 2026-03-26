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

/** Default page size */
export const DEFAULT_PAGE_SIZE = 20;

/** Maximum page size */
export const MAX_PAGE_SIZE = 50;

/** Clamp a requested limit to valid range [1, MAX_PAGE_SIZE], defaulting to DEFAULT_PAGE_SIZE */
export function clampPageSize(limit?: number): number {
	if (limit === undefined || limit <= 0) return DEFAULT_PAGE_SIZE;
	return Math.min(limit, MAX_PAGE_SIZE);
}
