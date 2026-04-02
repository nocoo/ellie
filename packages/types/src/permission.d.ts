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
 * - Mod: only forums where user.username is in forum.moderators
 * - User: no
 */
export declare function canModerate(user: User | null, forum: {
    moderators: string;
}): boolean;
/** Can user access the admin console (/admin)? */
export declare function canAccessAdmin(user: User | null): boolean;
/** Can user manage other users (ban/role change)? Admin only. */
export declare function canManageUsers(user: User | null): boolean;
/** Can user edit this post? Authors can edit their own; mods can edit any in their forum. */
export declare function canEditPost(user: User | null, post: Post, forum: {
    moderators: string;
}): boolean;
/**
 * Can user delete this post?
 * - Author: can delete own posts
 * - Admin/SuperMod: can delete any post
 * - Mod: CANNOT delete posts (per permission matrix)
 */
export declare function canDeletePost(user: User | null, post: Post, _forum: {
    moderators: string;
}): boolean;
/**
 * Can user delete this thread?
 * - Author: can delete own threads
 * - Admin/SuperMod: can delete any thread
 * - Mod: CANNOT delete threads (per permission matrix)
 */
export declare function canDeleteThread(user: User | null, thread: {
    authorId: number;
}, _forum: {
    moderators: string;
}): boolean;
/**
 * Can user perform thread management (sticky/highlight/digest/close)?
 * - Admin/SuperMod: all forums
 * - Mod: only forums where user is in moderators list
 * - User: no
 */
export declare function canManageThread(user: User | null, forum: {
    moderators: string;
}): boolean;
/**
 * Can user move thread to another forum?
 * - Admin/SuperMod: yes
 * - Mod: no (per permission matrix)
 * - User: no
 */
export declare function canMoveThread(user: User | null): boolean;
