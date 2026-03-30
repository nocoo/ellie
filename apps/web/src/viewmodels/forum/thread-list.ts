// viewmodels/forum/thread-list.ts — Thread list ViewModel
// Ref: 04d §版块帖子列表 — sorting, filtering, keyset pagination, badges

import { type Thread, decodeHighlight, getThreadBadges } from "@ellie/types";

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
 */
export function highlightStyle(
	hl: ReturnType<typeof decodeHighlight>,
): React.CSSProperties | undefined {
	if (!hl) return undefined;
	const style: React.CSSProperties = {};
	if (hl.color) style.color = hl.color;
	if (hl.bold) style.fontWeight = "bold";
	if (hl.italic) style.fontStyle = "italic";
	if (hl.underline) style.textDecoration = "underline";
	return Object.keys(style).length > 0 ? style : undefined;
}

/**
 * Format a timestamp for display (relative or absolute).
 */
export function formatTime(timestamp: number): string {
	if (timestamp === 0) return "";
	const now = Date.now() / 1000;
	const diff = now - timestamp;
	if (diff < 60) return "刚刚";
	if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
	if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
	if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`;
	return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}

/**
 * Format view/reply counts for display.
 */
export function formatStat(n: number): string {
	if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
	return String(n);
}
