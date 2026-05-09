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
	/** Digest icon shown to the right of the title (null if not a digest thread). */
	digestSrc: string | null;
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
		digestSrc: getDigestIconSrc(thread.digest),
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
 *   closed → special(1-5) → sticky(1-4) → folder_new/common
 *
 * Note: digest is NOT included here — it appears to the right of the
 * title (see getDigestIconSrc), matching the original Discuz <th> layout.
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
	// folder_new: last reply within 24 hours
	const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;
	if (thread.lastPostAt > oneDayAgo) return getStaticImageUrl("folder_new.gif");
	return getStaticImageUrl("folder_common.gif");
}

/**
 * Resolve the digest icon for the title area (right of subject).
 * Matches forumdisplay_list.htm <th> digest_N.gif inline icon.
 * Returns null for non-digest threads.
 */
export function getDigestIconSrc(digest: number): string | null {
	if (digest <= 0) return null;
	return getStaticImageUrl(`digest_${Math.min(digest, 3)}.gif`);
}

/**
 * Badge types that are already conveyed by icons (left column or title area).
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

// ---------------------------------------------------------------------------
// Inline thread page links (title-right pagination)
// ---------------------------------------------------------------------------

/** A page item: a page number or an "ellipsis" sentinel. */
export type InlinePageItem = number | "ellipsis";

/**
 * Calculate total pages for a thread.
 * `replies` does not include the OP post, so total posts = replies + 1.
 * Guards against postsPerPage <= 0 (returns 1).
 */
export function getThreadPageCount(replies: number, postsPerPage: number): number {
	if (postsPerPage <= 0) return 1;
	return Math.ceil((replies + 1) / postsPerPage);
}

/**
 * Generate inline page items for display to the right of the title.
 * Only called when pageCount > 1 (single-page threads show nothing).
 *
 * Shows pages starting from 2 (page 1 is the default landing page).
 * For short page counts (≤ 6), shows all pages.
 * For longer page counts, shows 2 3 4 5 ... lastPage.
 */
export function getInlinePageItems(pageCount: number): InlinePageItem[] {
	if (pageCount <= 1) return [];

	// Show all pages from 2..pageCount when total is small
	const MAX_INLINE = 6; // threshold: show all pages 2..N when N-1 <= MAX_INLINE
	if (pageCount - 1 <= MAX_INLINE) {
		return Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
	}

	// Show 2 3 4 5 ... lastPage
	const head = [2, 3, 4, 5];
	const result: InlinePageItem[] = [...head, "ellipsis", pageCount];
	return result;
}

/**
 * Encode a page number into a post cursor string for the thread detail page.
 * Page 1 returns null (no cursor = first page).
 * Page N returns base64-encoded { position: (N-1) * postsPerPage }.
 */
export function pageToPostCursor(page: number, postsPerPage: number): string | null {
	if (page <= 1) return null;
	const position = (page - 1) * postsPerPage;
	return btoa(JSON.stringify({ position }));
}

/**
 * Build the URL for a specific page of a thread.
 * Page 1: /threads/{id} (no query params)
 * Page N: /threads/{id}?page={N}
 */
export function getThreadPageUrl(threadId: number, page: number): string {
	if (page <= 1) return `/threads/${threadId}`;
	return `/threads/${threadId}?page=${page}`;
}

/**
 * Resolve the effective cursor for loading thread posts.
 *
 * Priority: explicit cursor > ?last=1 > ?page=N > first page (null).
 * Only `last === "1"` is treated as the last-page flag; any other value
 * (including "0") does not suppress ?page.
 */
export function resolveThreadPostCursor(
	params: { cursor?: string; page?: string; last?: string },
	postsPerPage: number,
): { cursor: string | undefined; isLastPage: boolean } {
	const isLastPage = params.last === "1";

	// Explicit cursor always wins
	if (params.cursor) {
		return { cursor: params.cursor, isLastPage: false };
	}

	// ?last=1 takes priority over ?page
	if (isLastPage) {
		return { cursor: undefined, isLastPage: true };
	}

	// Convert ?page=N to a position-based cursor
	if (params.page) {
		const pageNum = Number.parseInt(params.page, 10);
		if (!Number.isNaN(pageNum) && pageNum > 1) {
			const cursor = pageToPostCursor(pageNum, postsPerPage) ?? undefined;
			return { cursor, isLastPage: false };
		}
	}

	// Default: first page
	return { cursor: undefined, isLastPage: false };
}
