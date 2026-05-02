// Pagination helpers shared across handlers.

/**
 * Parse a `?limit=` query string value and clamp it to `[1, maxLimit]`.
 *
 * Behavior matches the inline implementations previously duplicated in
 * digest / user / message handlers:
 * - missing / empty / non-positive value -> `defaultLimit`
 * - positive value -> `min(value, maxLimit)`
 * - non-numeric value (e.g. `?limit=abc`) preserves the legacy NaN behavior:
 *   `Number.parseInt("abc") -> NaN`, `NaN <= 0` is false, so the function
 *   falls through to `Math.min(NaN, maxLimit) -> NaN`. No caller relies on
 *   this branch and tightening it would change existing endpoint behavior,
 *   so it is intentionally preserved here and validated by the unit test.
 */
export function clampLimit(
	limitParam: string | null,
	opts: { defaultLimit: number; maxLimit: number },
): number {
	const n = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	if (n === undefined || n <= 0) {
		return opts.defaultLimit;
	}
	return Math.min(n, opts.maxLimit);
}
