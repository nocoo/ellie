// models/permission.ts — Zero-dependency pure functions for permission checks
// Ref: 04a §Permission Model

import type { Forum, Post, Thread, User } from "./types";
import { UserRole, UserStatus } from "./types";

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

/** Can user view this forum? Hidden forums (status=0) are invisible. */
export function canViewForum(_user: User | null, forum: Forum): boolean {
	return forum.status !== 0;
}

/** Can user create a new thread in this forum? */
export function canCreateThread(user: User | null, _forum: Forum): boolean {
	if (!user) return false;
	return user.status === UserStatus.Active;
}

/** Can user reply to this thread? */
export function canReplyToThread(user: User | null, thread: Thread): boolean {
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
export function canModerate(user: User | null, forum: { moderators: string }): boolean {
	if (!user) return false;
	if (user.role === UserRole.Admin || user.role === UserRole.SuperMod) return true;
	if (user.role === UserRole.Mod) {
		const mods = parseModerators(forum.moderators);
		return mods.includes(user.username);
	}
	return false;
}

/** Can user access the admin console (/admin)? */
export function canAccessAdmin(user: User | null): boolean {
	if (!user) return false;
	return user.role === UserRole.Admin || user.role === UserRole.SuperMod;
}

/** Can user manage other users (ban/role change)? Admin only. */
export function canManageUsers(user: User | null): boolean {
	if (!user) return false;
	return user.role === UserRole.Admin;
}

// ─── Post-level Permissions ──────────────────────────────────────

/** Can user edit this post? Authors can edit their own; mods can edit any in their forum. */
export function canEditPost(user: User | null, post: Post, forum: { moderators: string }): boolean {
	if (!user) return false;
	if (user.id === post.authorId) return true;
	return canModerate(user, forum);
}

/** Can user delete this post? Authors can delete their own; mods can delete any. */
export function canDeletePost(
	user: User | null,
	post: Post,
	forum: { moderators: string },
): boolean {
	if (!user) return false;
	if (user.id === post.authorId) return true;
	return canModerate(user, forum);
}
