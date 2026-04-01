// viewmodels/forum/forum-list.ts — Forum list ViewModel
// Ref: 04d §论坛首页 — Group → Forum → Sub tree, visibility filter

import { type Forum, type ForumTreeNode, buildForumTree, filterVisibleForums } from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForumListState {
	tree: ForumTreeNode[];
	loading: boolean;
	error: string | null;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Forum statuses that should sink to the bottom of the group list.
 * status=3: QQ group forums (migrated from Discuz UCHome).
 */
const DEMOTED_STATUSES = new Set([3]);

/**
 * Build the visible forum tree from a flat forum list.
 * - Filters out invisible forums (status<=0) and their descendants.
 * - Demotes groups with specific statuses (e.g. QQ群) to the bottom.
 */
export function buildVisibleTree(forums: Forum[]): ForumTreeNode[] {
	const tree = buildForumTree(forums);
	const visible = tree.map(filterVisibleForums).filter((n): n is ForumTreeNode => n !== null);

	// Stable sort: normal groups first (in original order), demoted groups last
	return visible.sort((a, b) => {
		const aDemoted = DEMOTED_STATUSES.has(a.status) ? 1 : 0;
		const bDemoted = DEMOTED_STATUSES.has(b.status) ? 1 : 0;
		return aDemoted - bDemoted;
	});
}

/**
 * Format a large number for display (e.g. 1200 → "1,200", 8500 → "8,500").
 */
export function formatCount(n: number): string {
	return n.toLocaleString("zh-CN");
}

/**
 * Parse comma-separated moderator names into an array.
 * Trims whitespace and filters out empty strings.
 */
export function parseModerators(moderators: string): string[] {
	if (!moderators) return [];
	return moderators
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Threshold for switching between wide (row) and grid layout.
 * Groups with more children than this use 2-col grid layout.
 */
export const GRID_THRESHOLD = 10;

/**
 * Compute total stats for a forum node (self + children).
 */
export function totalStats(node: ForumTreeNode): { threads: number; posts: number } {
	let threads = node.threads;
	let posts = node.posts;
	for (const child of node.children) {
		const childStats = totalStats(child);
		threads += childStats.threads;
		posts += childStats.posts;
	}
	return { threads, posts };
}
