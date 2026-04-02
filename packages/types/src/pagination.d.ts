/** Cursor payload — the actual data encoded inside a cursor string */
export interface CursorPayload {
    sortValue: number;
    id: number;
}
/**
 * Encode a cursor payload into an opaque string.
 * Format: base64(JSON({ sortValue, id }))
 */
export declare function encodeCursor(payload: CursorPayload): string;
/**
 * Decode an opaque cursor string back into a payload.
 * Returns null if the cursor is invalid.
 */
export declare function decodeCursor(cursor: string): CursorPayload | null;
/** Default page size */
export declare const DEFAULT_PAGE_SIZE = 20;
/** Maximum page size */
export declare const MAX_PAGE_SIZE = 50;
/** Clamp a requested limit to valid range [1, MAX_PAGE_SIZE], defaulting to DEFAULT_PAGE_SIZE */
export declare function clampPageSize(limit?: number): number;
