// viewmodels/shared/params.ts — URL parameter safe parsing utilities
// Single source of truth for parsing route params and search params
// across all forum page.tsx files.

/**
 * Parse a string param to integer with fallback.
 * Returns the parsed integer, or `fallback` if the input is
 * undefined, empty, or not a valid number.
 */
export function parseIntParam(raw: string | undefined | null, fallback = 0): number {
	if (raw == null || raw === "") return fallback;
	const n = Number.parseInt(raw, 10);
	return Number.isNaN(n) ? fallback : n;
}

/**
 * Parse a page number from search params.
 * Always returns >= 1 (clamps invalid/zero values to 1).
 */
export function parsePageParam(raw: string | undefined | null): number {
	return Math.max(1, parseIntParam(raw, 1));
}
