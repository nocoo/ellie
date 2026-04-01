// viewmodels/forum/thread-list.ts — Thread list ViewModel
// Ref: 04d §版块帖子列表 — sorting, filtering, keyset pagination, badges

import { type Thread, StickyLevel, decodeHighlight, getThreadBadges } from "@ellie/types";
import { getStaticImageUrl } from "@/lib/cdn";
import { formatRelativeTime } from "@/viewmodels/shared/formatting";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThreadSort = "latest" | "newest" | "hot";

export interface ThreadListFilters {
	forumId?: number;
	sort: ThreadSort;
	digestOnly: boolean;
}

export interface ThreadDisplayItem {
	thread: Thread;
	badges: ReturnType<typeof getThreadBadges>;
	highlight: ReturnType<typeof decodeHighlight>;
}

export interface ThreadListState {
	items: ThreadDisplayItem[];
	loading: boolean;
	error: string | null;
	sort: ThreadSort;
	digestOnly: boolean;
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Enrich a raw Thread array with computed badges and highlight styles.
 */
export function enrichThreads(threads: Thread[]): ThreadDisplayItem[] {
	return threads.map((thread) => ({
		thread,
		badges: getThreadBadges(thread),
		highlight: decodeHighlight(thread.highlight),
	}));
}

/**
 * Build highlight inline style from decoded HighlightStyle.
 * Returns a plain record (no React dependency) suitable for `style` prop.
 */
export function highlightStyle(
	hl: ReturnType<typeof decodeHighlight>,
): Record<string, string> | undefined {
	if (!hl) return undefined;
	const style: Record<string, string> = {};
	if (hl.color) style.color = hl.color;
	if (hl.bold) style.fontWeight = "bold";
	if (hl.italic) style.fontStyle = "italic";
	if (hl.underline) style.textDecoration = "underline";
	return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * Format a timestamp for display (relative or absolute).
 * @deprecated Use formatRelativeTime from @/viewmodels/shared/formatting directly.
 */
export function formatTime(timestamp: number): string {
	return formatRelativeTime(timestamp);
}

/**
 * Format view/reply counts for display.
 */
export function formatStat(n: number): string {
	if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}

/**
 * Resolve the classic Discuz folder/pin icon for a thread row.
 * Returns a CDN URL for the appropriate GIF icon.
 */
export function getThreadIconSrc(thread: {
	closed: number;
	special: number;
	sticky: StickyLevel;
}): string {
	if (thread.closed === 1) return getStaticImageUrl("folder_lock.gif");
	if (thread.special === 1) return getStaticImageUrl("pollsmall.gif");
	if (thread.sticky >= StickyLevel.Forum)
		return getStaticImageUrl(`pin_${Math.min(thread.sticky, 3)}.gif`);
	return getStaticImageUrl("folder_common.gif");
}
