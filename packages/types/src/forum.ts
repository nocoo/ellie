// models/forum.ts — Forum model pure functions
// Ref: 04c §ForumManagement (buildForumTree), 04d §ForumList (filterVisibleForums)

import type { Forum } from "./types";

// ─── Forum Tree ─────────────────────────────────────────

export interface ForumTreeNode extends Forum {
	children: ForumTreeNode[];
}

/**
 * Build a tree from flat Forum[] array.
 * Structure: Group (parentId=0) → Forum → Sub
 * Sorted by displayOrder within each level.
 */
export function buildForumTree(forums: Forum[]): ForumTreeNode[] {
	// Group forums by parentId
	const childrenMap = new Map<number, ForumTreeNode[]>();

	for (const forum of forums) {
		const node: ForumTreeNode = { ...forum, children: [] };
		const siblings = childrenMap.get(forum.parentId);
		if (siblings) {
			siblings.push(node);
		} else {
			childrenMap.set(forum.parentId, [node]);
		}
	}

	// Sort each group by displayOrder
	for (const siblings of childrenMap.values()) {
		siblings.sort((a, b) => a.displayOrder - b.displayOrder);
	}

	// Recursively attach children
	function attachChildren(nodes: ForumTreeNode[]): void {
		for (const node of nodes) {
			node.children = childrenMap.get(node.id) ?? [];
			attachChildren(node.children);
		}
	}

	// Root nodes are those with parentId=0
	const roots = childrenMap.get(0) ?? [];
	attachChildren(roots);

	return roots;
}

// ─── Visibility Filter ──────────────────────────────────

/**
 * Filter a tree node: remove hidden forums (status=0) and their descendants.
 * Returns true if this node (or any of its children) is visible.
 */
export function filterVisibleForums(node: ForumTreeNode): ForumTreeNode | null {
	if (node.status === 0) return null;

	const visibleChildren: ForumTreeNode[] = [];
	for (const child of node.children) {
		const filtered = filterVisibleForums(child);
		if (filtered) visibleChildren.push(filtered);
	}

	return { ...node, children: visibleChildren };
}
