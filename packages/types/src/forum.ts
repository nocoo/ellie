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
	// Group forums by parentId (skip self-referencing nodes to prevent infinite recursion)
	const childrenMap = new Map<number, ForumTreeNode[]>();

	for (const forum of forums) {
		if (forum.id === forum.parentId) continue; // skip self-referencing nodes
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

// ─── Ancestor Chain ────────────────────────────────────

/**
 * Walk up the parentId chain from `forumId` and return the ancestor path.
 * Returns [root, ..., parent, self] (top-level → current).
 * Returns empty array if `forumId` is not found.
 */
export function findForumAncestors(forums: Forum[], forumId: number): Forum[] {
	const byId = new Map<number, Forum>();
	for (const f of forums) byId.set(f.id, f);

	const ancestors: Forum[] = [];
	let current = byId.get(forumId);

	while (current) {
		ancestors.push(current);
		if (current.parentId === 0 || current.parentId === current.id) break;
		current = byId.get(current.parentId);
	}

	ancestors.reverse();
	return ancestors;
}

// ─── Visibility Filter ──────────────────────────────────

/**
 * Filter a tree node: remove invisible forums and their descendants.
 * - status=0: hidden (admin-hidden)
 * - status=-1: deleted (migrated placeholder)
 */
export function filterVisibleForums(node: ForumTreeNode): ForumTreeNode | null {
	if (node.status <= 0) return null;

	const visibleChildren: ForumTreeNode[] = [];
	for (const child of node.children) {
		const filtered = filterVisibleForums(child);
		if (filtered) visibleChildren.push(filtered);
	}

	return { ...node, children: visibleChildren };
}
