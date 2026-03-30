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
 * Walk up the parentId chain from `forumId` and return the ancestor path.
 * Returns [root, ..., parent, self] (top-level → current).
 * Returns empty array if `forumId` is not found.
 */
export declare function findForumAncestors(forums: Forum[], forumId: number): Forum[];
/**
 * Filter a tree node: remove invisible forums and their descendants.
 * - status=0: hidden (admin-hidden)
 * - status=-1: deleted (migrated placeholder)
 */
export declare function filterVisibleForums(node: ForumTreeNode): ForumTreeNode | null;
