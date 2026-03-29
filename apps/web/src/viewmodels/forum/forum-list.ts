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
 * Build the visible forum tree from a flat forum list.
 * Filters out hidden forums (status=0) and their descendants.
 */
export function buildVisibleTree(forums: Forum[]): ForumTreeNode[] {
	const tree = buildForumTree(forums);
	return tree.map(filterVisibleForums).filter((n): n is ForumTreeNode => n !== null);
}

/**
 * Format a large number for display (e.g. 1200 → "1,200", 8500 → "8,500").
 */
export function formatCount(n: number): string {
	return n.toLocaleString("zh-CN");
}

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
