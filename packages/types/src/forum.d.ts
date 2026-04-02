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
 * - status=2: paused forums (暂停版面)
 * - status=3: QQ group forums (migrated from Discuz UCHome) — hidden by default
 */
export declare function filterVisibleForums(node: ForumTreeNode): ForumTreeNode | null;
