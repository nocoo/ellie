// Unified visibility filtering constants and helpers
// Centralizes the visibility rules that were scattered across handlers
//
// Visibility rules (from 9 security audits):
// - Threads: sticky >= 0 means visible (negative = hidden/deleted/placeholder)
// - Posts: invisible = 0 means visible (other values = deleted/pending/ignored)
// - Users: status >= 0 means normal (negative = banned/archived/placeholder)
// - Forums: status = 1 means active, plus visibility level check

import { UserRole } from "@ellie/types";
import type { ForumVisibility, VisibilityContext } from "@ellie/types";

// ─── SQL Filter Constants ────────────────────────────────────

/**
 * SQL condition for visible threads.
 * sticky >= 0: Normal (0) and sticky (1/2/3) threads are visible
 * sticky < 0: Hidden (-1), deleted (-2), placeholder (-3) are hidden
 */
export const THREAD_VISIBLE = "sticky >= 0";

/**
 * SQL condition for visible posts.
 * invisible = 0: Normal visible posts
 * invisible != 0: Deleted, pending moderation, or ignored posts
 */
export const POST_VISIBLE = "invisible = 0";

/**
 * SQL condition for normal users (not banned/archived/placeholder).
 * status >= 0: Normal (0) and higher statuses
 * status < 0: Banned (-1), archived (-2), placeholder (-3)
 */
export const USER_ACTIVE = "status >= 0";

/**
 * SQL condition for active forums.
 * status = 1: Active forum
 * status = 0: Hidden by admin
 * status = -1: Deleted
 * status = 2: Paused
 * status = 3: QQ group (special)
 */
export const FORUM_ACTIVE = "status = 1";

// ─── Table-prefixed versions for JOINs ───────────────────────

/** Thread visibility with table prefix */
export const threadVisible = (alias = "t") => `${alias}.sticky >= 0`;

/** Post visibility with table prefix */
export const postVisible = (alias = "p") => `${alias}.invisible = 0`;

/** User active status with table prefix */
export const userActive = (alias = "u") => `${alias}.status >= 0`;

/** Forum active status with table prefix */
export const forumActive = (alias = "f") => `${alias}.status = 1`;

/**
 * Runtime predicate: is this forum row publicly active?
 * Equivalent to the SQL `forumActive(alias)` filter.
 * Active = status === 1; everything else (hidden 0, deleted -1,
 * paused 2, QQ-group 3, or any future unknown positive status)
 * is treated as not active so unknown states default to hidden.
 */
export function isForumActive<T extends { status: number }>(
	forum: T | null | undefined,
): forum is T {
	return forum != null && forum.status === 1;
}

// ─── Forum Visibility Context ────────────────────────────────

/**
 * Build visibility context from optional user auth.
 * Used for forum visibility filtering.
 */
export function buildVisibilityContext(
	user: { userId: number; role: number } | null,
): VisibilityContext {
	return {
		isLoggedIn: user !== null,
		role: user?.role ?? UserRole.User,
	};
}

/**
 * Build SQL WHERE clause for forum visibility filtering (visibility only).
 * Returns conditions that filter forums based on user's visibility context.
 * Does NOT include status check - use buildForumFilter for full filtering.
 *
 * @param visCtx - Visibility context from user auth
 * @param alias - Table alias for forums table (default: "f")
 * @returns SQL condition string for visibility only
 */
export function buildForumVisibilityFilter(visCtx: VisibilityContext, alias = "f"): string {
	const conditions: string[] = [`${alias}.visibility = 'public'`];

	if (visCtx.isLoggedIn) {
		conditions.push(`${alias}.visibility = 'members'`);
	}
	if (
		visCtx.role === UserRole.Mod ||
		visCtx.role === UserRole.SuperMod ||
		visCtx.role === UserRole.Admin
	) {
		conditions.push(`${alias}.visibility = 'staff'`);
	}
	if (visCtx.role === UserRole.Admin) {
		conditions.push(`${alias}.visibility = 'admin'`);
	}

	return `(${conditions.join(" OR ")})`;
}

/**
 * Build SQL WHERE clause for forum filtering (status + visibility).
 * Combines status = 1 check with visibility filtering.
 * Use this when querying across forums (e.g., user's threads/posts across all forums).
 *
 * @param visCtx - Visibility context from user auth
 * @param alias - Table alias for forums table (default: "f")
 * @returns SQL condition string for status AND visibility
 */
export function buildForumFilter(visCtx: VisibilityContext, alias = "f"): string {
	const statusFilter = forumActive(alias);
	const visibilityFilter = buildForumVisibilityFilter(visCtx, alias);
	return `${statusFilter} AND ${visibilityFilter}`;
}

/**
 * Check if a user can view a forum with given visibility level.
 * TypeScript version of the SQL filter for post-query filtering.
 */
export function canViewForumVisibility(
	visibility: ForumVisibility,
	visCtx: VisibilityContext,
): boolean {
	switch (visibility) {
		case "public":
			return true;
		case "members":
			return visCtx.isLoggedIn;
		case "staff":
			return (
				visCtx.role === UserRole.Mod ||
				visCtx.role === UserRole.SuperMod ||
				visCtx.role === UserRole.Admin
			);
		case "admin":
			return visCtx.role === UserRole.Admin;
		default:
			return false;
	}
}
