// models/forum.ts — Forum model pure functions
// Ref: 04c §ForumManagement (buildForumTree), 04d §ForumList (filterVisibleForums)

import type { Forum, ForumVisibility } from "./types";
import { UserRole } from "./types";

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
export function canViewForum(visibility: ForumVisibility, ctx: VisibilityContext): boolean {
	switch (visibility) {
		case "public":
			return true;
		case "members":
			return ctx.isLoggedIn;
		case "staff":
			return (
				ctx.role === UserRole.Admin || ctx.role === UserRole.SuperMod || ctx.role === UserRole.Mod
			);
		case "admin":
			return ctx.role === UserRole.Admin;
		default:
			return true;
	}
}

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
export function filterVisibleForums(
	node: ForumTreeNode,
	ctx: VisibilityContext = { isLoggedIn: false, role: UserRole.User },
): ForumTreeNode | null {
	// Status-based filtering
	if (node.status <= 0 || node.status === 2 || node.status === 3) return null;

	// Visibility-based filtering
	if (!canViewForum(node.visibility, ctx)) return null;

	const visibleChildren: ForumTreeNode[] = [];
	for (const child of node.children) {
		const filtered = filterVisibleForums(child, ctx);
		if (filtered) visibleChildren.push(filtered);
	}

	return { ...node, children: visibleChildren };
}
