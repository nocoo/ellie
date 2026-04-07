import type { Forum, Post, Thread, User } from "./types";
/** Minimal user data needed for permission checks */
export type PermissionUser = Pick<User, "id" | "username" | "role" | "status">;
/** Minimal forum data needed for permission checks */
export type PermissionForum = Pick<Forum, "moderators">;
/** Minimal post data needed for permission checks */
export type PermissionPost = Pick<Post, "id" | "authorId">;
/** Minimal thread data needed for permission checks */
export type PermissionThread = Pick<Thread, "id" | "authorId" | "closed">;
/**
 * Can user view this forum based on status only?
 * @deprecated Use canViewForumVisibility from forum.ts for full visibility check
 */
export declare function canViewForum(_user: PermissionUser | null, forum: Forum): boolean;
/** Can user create a new thread in this forum? */
export declare function canCreateThread(user: PermissionUser | null, _forum: Forum): boolean;
/** Can user reply to this thread? */
export declare function canReplyToThread(
	user: PermissionUser | null,
	thread: PermissionThread,
): boolean;
/**
 * Can user perform moderation actions (sticky/digest/close/move/delete others' posts)?
 * - Admin / SuperMod: all forums
 * - Mod: only forums where user.username is in forum.moderators
 * - User: no
 */
export declare function canModerate(user: PermissionUser | null, forum: PermissionForum): boolean;
/** Can user access the admin console (/admin)? */
export declare function canAccessAdmin(user: PermissionUser | null): boolean;
/** Can user manage other users (ban/role change)? Admin only. */
export declare function canManageUsers(user: PermissionUser | null): boolean;
/** Can user edit this post? Authors can edit their own; mods can edit any in their forum. */
export declare function canEditPost(
	user: PermissionUser | null,
	post: PermissionPost,
	forum: PermissionForum,
): boolean;
/**
 * Can user delete this post?
 * - Author: can delete own posts
 * - Admin/SuperMod: can delete any post
 * - Mod: CANNOT delete posts (per permission matrix)
 */
export declare function canDeletePost(
	user: PermissionUser | null,
	post: PermissionPost,
	_forum: PermissionForum,
): boolean;
/**
 * Can user delete this thread?
 * - Author: can delete own threads
 * - Admin/SuperMod: can delete any thread
 * - Mod: CANNOT delete threads (per permission matrix)
 */
export declare function canDeleteThread(
	user: PermissionUser | null,
	thread: {
		authorId: number;
	},
	_forum: PermissionForum,
): boolean;
/**
 * Can user perform thread management (sticky/highlight/digest/close)?
 * - Admin/SuperMod: all forums
 * - Mod: only forums where user is in moderators list
 * - User: no
 */
export declare function canManageThread(
	user: PermissionUser | null,
	forum: PermissionForum,
): boolean;
/**
 * Can user move thread to another forum?
 * - Admin/SuperMod: yes
 * - Mod: no (per permission matrix)
 * - User: no
 */
export declare function canMoveThread(user: PermissionUser | null): boolean;
