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
	iconSrc: string;
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
		badges: filterIconRedundantBadges(getThreadBadges(thread)),
		highlight: decodeHighlight(thread.highlight),
		iconSrc: getThreadIconSrc(thread),
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
 *
 * Priority matches forumdisplay_list.htm <td class="icn">:
 *   closed → special(1-5) → sticky(1-4) → digest → folder_new/common
 */
export function getThreadIconSrc(thread: {
	closed: number;
	special: number;
	sticky: StickyLevel;
	digest: number;
	lastPostAt: number;
}): string {
	if (thread.closed === 1) return getStaticImageUrl("folder_lock.gif");
	// Special thread types: poll/trade/reward/activity/debate
	if (thread.special === 1) return getStaticImageUrl("pollsmall.gif");
	if (thread.special === 2) return getStaticImageUrl("tradesmall.gif");
	if (thread.special === 3) return getStaticImageUrl("rewardsmall.gif");
	if (thread.special === 4) return getStaticImageUrl("activitysmall.gif");
	if (thread.special === 5) return getStaticImageUrl("debatesmall.gif");
	// Sticky: displayorder 1-4 → pin_1..4.gif; clamp >4 to pin_4
	if (thread.sticky >= StickyLevel.Forum)
		return getStaticImageUrl(`pin_${Math.min(thread.sticky, 4)}.gif`);
	if (thread.digest > 0) return getStaticImageUrl(`digest_${Math.min(thread.digest, 3)}.gif`);
	// folder_new: last reply within 24 hours
	const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
	if (thread.lastPostAt > oneDayAgo) return getStaticImageUrl("folder_new.gif");
	return getStaticImageUrl("folder_common.gif");
}

/**
 * Badge types that are already conveyed by the thread icon column.
 * These are filtered out in the thread list to avoid redundancy.
 */
const ICON_REPRESENTED_BADGE_TYPES = new Set(["sticky", "digest", "closed", "special"]);

/**
 * Filter badges to only include those NOT already represented by the icon.
 * Keeps typeName (thread classification) since it has no icon equivalent.
 */
export function filterIconRedundantBadges(
	badges: ReturnType<typeof getThreadBadges>,
): ReturnType<typeof getThreadBadges> {
	return badges.filter((b) => !ICON_REPRESENTED_BADGE_TYPES.has(b.type));
}
