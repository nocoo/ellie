import type { Forum, ForumVisibility } from "./types";
import { UserRole } from "./types";
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
 * User context for visibility filtering.
 * role: UserRole enum value (0=User, 1=Admin, 2=SuperMod, 3=Mod)
 * isLoggedIn: whether the user is authenticated
 */
export interface VisibilityContext {
    isLoggedIn: boolean;
    role: UserRole;
}
/**
 * Check if user can view a forum based on its visibility setting.
 * - public: everyone
 * - members: logged in users only
 * - staff: mods, super mods, and admins
 * - admin: admins only
 */
export declare function canViewForum(visibility: ForumVisibility, ctx: VisibilityContext): boolean;
/**
 * Filter a tree node: remove invisible forums and their descendants.
 * Checks both status and visibility.
 *
 * Status filtering:
 * - status=0: hidden (admin-hidden)
 * - status=-1: deleted (migrated placeholder)
 * - status=2: paused forums (暂停版面)
 * - status=3: QQ group forums (migrated from Discuz UCHome) — hidden by default
 *
 * Visibility filtering:
 * - public: everyone can see
 * - members: only logged-in users
 * - staff: only mods/super mods/admins
 * - admin: only admins
 */
export declare function filterVisibleForums(node: ForumTreeNode, ctx?: VisibilityContext): ForumTreeNode | null;
