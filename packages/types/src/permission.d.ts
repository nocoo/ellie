import type { Forum, Post, Thread, User } from "./types";
/** Can user view this forum? Hidden forums (status=0) are invisible. */
export declare function canViewForum(_user: User | null, forum: Forum): boolean;
/** Can user create a new thread in this forum? */
export declare function canCreateThread(user: User | null, _forum: Forum): boolean;
/** Can user reply to this thread? */
export declare function canReplyToThread(user: User | null, thread: Thread): boolean;
/**
 * Can user perform moderation actions (sticky/digest/close/move/delete others' posts)?
 * - Admin / SuperMod: all forums
 * - Mod: all forums (simplified — no moderators table yet)
 * - User: no
 */
export declare function canModerate(user: User | null, _forumId: number): boolean;
/** Can user access the admin console (/admin)? */
export declare function canAccessAdmin(user: User | null): boolean;
/** Can user manage other users (ban/role change)? Admin only. */
export declare function canManageUsers(user: User | null): boolean;
/** Can user delete this post? Authors can delete their own; mods can delete any. */
export declare function canDeletePost(user: User | null, post: Post, forumId: number): boolean;
