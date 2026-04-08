// viewmodels/forum/thread-list.ts — Thread list ViewModel
// Ref: 04d §版块主题列表 — sorting, filtering, keyset pagination, badges

import { getStaticImageUrl } from "@/lib/cdn";
import { StickyLevel, type Thread, decodeHighlight, getThreadBadges } from "@ellie/types";

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
 * Resolve the classic Discuz folder/pin icon for a thread row.
 * Returns a CDN URL for the appropriate GIF icon.
 */
export function getThreadIconSrc(thread: {
	closed: number;
	special: number;
	sticky: StickyLevel;
	digest: number;
	lastPostAt: number;
}): string {
	if (thread.closed === 1) return getStaticImageUrl("folder_lock.gif");
	if (thread.special === 1) return getStaticImageUrl("pollsmall.gif");
	if (thread.sticky >= StickyLevel.Forum)
		return getStaticImageUrl(`pin_${Math.min(thread.sticky, 3)}.gif`);
	if (thread.digest > 0) return getStaticImageUrl(`digest_${Math.min(thread.digest, 3)}.gif`);
	// folder_new: last reply within 24 hours
	const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
	if (thread.lastPostAt > oneDayAgo) return getStaticImageUrl("folder_new.gif");
	return getStaticImageUrl("folder_common.gif");
}
