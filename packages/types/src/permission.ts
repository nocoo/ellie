// models/permission.ts — Zero-dependency pure functions for permission checks
// Ref: 04a §Permission Model

import type { Forum, Post, Thread, User } from "./types";
import { UserRole, UserStatus } from "./types";

// ─── Type Aliases for Permission Checks ──────────────────────────
// These allow passing partial User objects with only the fields needed for permission checks

/** Minimal user data needed for permission checks */
export type PermissionUser = Pick<User, "id" | "username" | "role" | "status">;

/** Minimal forum data needed for permission checks */
export type PermissionForum = Pick<Forum, "moderators">;

/** Minimal post data needed for permission checks */
export type PermissionPost = Pick<Post, "id" | "authorId">;

/** Minimal thread data needed for permission checks */
export type PermissionThread = Pick<Thread, "id" | "authorId" | "closed">;

// ─── Internal Helpers ────────────────────────────────────────────

/**
 * Parse comma-separated moderator usernames into an array.
 * Trims whitespace and filters out empty strings.
 */
function parseModerators(moderators: string): string[] {
	if (!moderators) return [];
	return moderators
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

// ─── Forum Visibility ────────────────────────────────────────────

/**
 * Can user view this forum based on status only?
 * @deprecated Use canViewForumVisibility from forum.ts for full visibility check
 */
export function canViewForum(_user: PermissionUser | null, forum: Forum): boolean {
	return forum.status !== 0;
}

/** Can user create a new thread in this forum? */
export function canCreateThread(user: PermissionUser | null, _forum: Forum): boolean {
	if (!user) return false;
	return user.status === UserStatus.Active;
}

/** Can user reply to this thread? */
export function canReplyToThread(user: PermissionUser | null, thread: PermissionThread): boolean {
	if (!user) return false;
	if (user.status !== UserStatus.Active) return false;
	return thread.closed === 0;
}

// ─── Moderation ──────────────────────────────────────────────────

/**
 * Can user perform moderation actions (sticky/digest/close/move/delete others' posts)?
 * - Admin / SuperMod: all forums
 * - Mod: only forums where user.username is in forum.moderators
 * - User: no
 */
export function canModerate(user: PermissionUser | null, forum: PermissionForum): boolean {
	if (!user) return false;
	if (user.role === UserRole.Admin || user.role === UserRole.SuperMod) return true;
	if (user.role === UserRole.Mod) {
		const mods = parseModerators(forum.moderators);
		return mods.includes(user.username);
	}
	return false;
}

/** Can user access the admin console (/admin)? */
export function canAccessAdmin(user: PermissionUser | null): boolean {
	if (!user) return false;
	return user.role === UserRole.Admin || user.role === UserRole.SuperMod;
}

/** Can user manage other users (ban/role change)? Admin only. */
export function canManageUsers(user: PermissionUser | null): boolean {
	if (!user) return false;
	return user.role === UserRole.Admin;
}

// ─── Post-level Permissions ──────────────────────────────────────

/** Can user edit this post? Authors can edit their own; mods can edit any in their forum. */
export function canEditPost(
	user: PermissionUser | null,
	post: PermissionPost,
	forum: PermissionForum,
): boolean {
	if (!user) return false;
	if (user.id === post.authorId) return true;
	return canModerate(user, forum);
}

/**
 * Can user delete this post?
 * - Author: can delete own posts
 * - Admin/SuperMod: can delete any post
 * - Mod: CANNOT delete posts (per permission matrix)
 */
export function canDeletePost(
	user: PermissionUser | null,
	post: PermissionPost,
	_forum: PermissionForum,
): boolean {
	if (!user) return false;
	if (user.id === post.authorId) return true;
	// Only Admin/SuperMod can delete others' posts — Mod cannot
	return user.role === UserRole.Admin || user.role === UserRole.SuperMod;
}

// ─── Thread-level Permissions ────────────────────────────────────

/**
 * Can user delete this thread?
 * - Author: can delete own threads
 * - Admin/SuperMod: can delete any thread
 * - Mod: CANNOT delete threads (per permission matrix)
 */
export function canDeleteThread(
	user: PermissionUser | null,
	thread: { authorId: number },
	_forum: PermissionForum,
): boolean {
	if (!user) return false;
	if (user.id === thread.authorId) return true;
	// Only Admin/SuperMod can delete others' threads — Mod cannot
	return user.role === UserRole.Admin || user.role === UserRole.SuperMod;
}

/**
 * Can user perform thread management (sticky/highlight/digest/close)?
 * - Admin/SuperMod: all forums
 * - Mod: only forums where user is in moderators list
 * - User: no
 */
export function canManageThread(user: PermissionUser | null, forum: PermissionForum): boolean {
	return canModerate(user, forum);
}

/**
 * Can user move thread to another forum?
 * - Admin/SuperMod: yes
 * - Mod: no (per permission matrix)
 * - User: no
 */
export function canMoveThread(user: PermissionUser | null): boolean {
	if (!user) return false;
	return user.role === UserRole.Admin || user.role === UserRole.SuperMod;
}
