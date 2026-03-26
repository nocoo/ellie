import type { Forum } from "./types";
export interface ForumTreeNode extends Forum {
	children: ForumTreeNode[];
}
/**
 * Build a tree from flat Forum[] array.
 * Structure: Group (parentId=0) → Forum → Sub
 * Sorted by displayOrder within each level.
 */
export declare function buildForumTree(forums: Forum[]): ForumTreeNode[];
/**
 * Filter a tree node: remove hidden forums (status=0) and their descendants.
 * Returns true if this node (or any of its children) is visible.
 */
export declare function filterVisibleForums(node: ForumTreeNode): ForumTreeNode | null;
