// viewmodels/forum/forum-list.ts — Forum list page ViewModel
// Ref: 04d §论坛首页 — Grouped forum list with visibility filtering

import type { Repositories } from "@ellie/repositories";
import { type ForumTreeNode, buildForumTree, filterVisibleForums } from "@ellie/types";
import type { Forum } from "@ellie/types";

export interface ForumListData {
	/** Visible tree (hidden forums filtered out) */
	tree: ForumTreeNode[];
	/** All forums (unfiltered, for breadcrumb/lookup use) */
	allForums: Forum[];
}

/**
 * Fetch and build the visible forum tree for the forum homepage.
 *
 * Pipeline: listAll → buildForumTree → filterVisibleForums (status=0 removed)
 */
export async function fetchForumList(repos: Repositories): Promise<ForumListData> {
	const allForums = await repos.forums.listAll();
	const tree = buildForumTree(allForums);

	// Filter out hidden forums (status=0)
	const visibleTree: ForumTreeNode[] = [];
	for (const node of tree) {
		const filtered = filterVisibleForums(node);
		if (filtered) visibleTree.push(filtered);
	}

	return { tree: visibleTree, allForums };
}

/**
 * Count total visible forums (non-group nodes) in a tree.
 * Useful for displaying "N forums" stats.
 */
export function countForums(tree: ForumTreeNode[]): number {
	let count = 0;
	function walk(nodes: ForumTreeNode[]): void {
		for (const node of nodes) {
			if (node.type !== "group") count++;
			walk(node.children);
		}
	}
	walk(tree);
	return count;
}

/**
 * Find a forum by ID in a flat forum list.
 * Returns null if not found.
 */
export function findForumById(forums: Forum[], id: number): Forum | null {
	return forums.find((f) => f.id === id) ?? null;
}
