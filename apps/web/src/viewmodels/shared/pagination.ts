// viewmodels/shared/pagination.ts — Shared pagination types and utilities
// Single source of truth for cursor-based pagination result type and
// page number generation algorithm.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cursor-based paginated result envelope. */
export interface PaginatedResult<T> {
	items: T[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

/** Create an empty PaginatedResult for error fallback. */
export function emptyPage<T>(): PaginatedResult<T> {
	return { items: [], nextCursor: null, prevCursor: null, total: 0 };
}

// ---------------------------------------------------------------------------
// Page number generation
// ---------------------------------------------------------------------------

/** Sentinel value representing a gap (ellipsis) between page numbers. */
export type PageItem = number | "ellipsis";

/**
 * Generate page number items with ellipsis gaps.
 *
 * Strategy: always show first `headCount` pages, last `tailCount` pages,
 * and a window of `windowSize` around the current page. Gaps are filled
 * with a single "ellipsis" sentinel.
 */
export function generatePageNumbers(
	current: number,
	total: number,
	headCount = 5,
	tailCount = 3,
	windowSize = 2,
): PageItem[] {
	if (total <= 0) return [];
	if (total <= headCount + tailCount + 1) {
		return Array.from({ length: total }, (_, i) => i + 1);
	}

	const pages = new Set<number>();

	// Head: 1..headCount
	for (let i = 1; i <= Math.min(headCount, total); i++) pages.add(i);

	// Window around current
	for (let i = Math.max(1, current - windowSize); i <= Math.min(total, current + windowSize); i++)
		pages.add(i);

	// Tail: last tailCount pages
	for (let i = Math.max(1, total - tailCount + 1); i <= total; i++) pages.add(i);

	// Sort and insert ellipsis where there are gaps
	const sorted = [...pages].sort((a, b) => a - b);
	const result: PageItem[] = [];

	for (let i = 0; i < sorted.length; i++) {
		const curr = sorted[i] as number;
		const prev = sorted[i - 1] as number | undefined;
		if (prev !== undefined && curr - prev > 1) {
			result.push("ellipsis");
		}
		result.push(curr);
	}

	return result;
}
