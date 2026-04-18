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
/**
 * Encode any cursor payload object into an opaque base64 string.
 * This is the generic version that works with any payload shape.
 */
export declare function encodeGenericCursor<T extends object>(payload: T): string;
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
export declare function decodeGenericCursor<T extends object>(cursor: string, validator: (parsed: Partial<T>) => boolean): T | null;
/** Default page size */
export declare const DEFAULT_PAGE_SIZE = 20;
/** Maximum page size */
export declare const MAX_PAGE_SIZE = 50;
/** Clamp a requested limit to valid range [1, MAX_PAGE_SIZE], defaulting to DEFAULT_PAGE_SIZE */
export declare function clampPageSize(limit?: number): number;
