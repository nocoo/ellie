// viewmodels/shared/params.ts — URL parameter safe parsing utilities
// Single source of truth for parsing route params and search params
// across all forum page.tsx files.

/**
 * Parse a string param to integer.
 * Returns the parsed integer, or `null` if the input is
 * undefined, empty, or not a valid number.
 */
export function parseIntParam(raw: string | undefined | null): number | null {
	if (raw == null || raw === "") return null;
	const n = Number.parseInt(raw, 10);
	return Number.isNaN(n) ? null : n;
}

/**
 * Parse a page number from search params.
 * Always returns >= 1 (clamps invalid/zero values to 1).
 */
export function parsePageParam(raw: string | undefined | null): number {
	const n = parseIntParam(raw);
	return n != null && n >= 1 ? n : 1;
}
