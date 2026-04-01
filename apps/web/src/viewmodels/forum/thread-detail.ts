// viewmodels/forum/thread-detail.ts — Thread detail ViewModel
// Ref: 04d §帖子详情 — enriched posts, attachment grouping, permissions

import { filterContent } from "@/lib/content-filter";
import {
	type Attachment,
	type Post,
	type Thread,
	canDeletePost,
	canDeleteThread,
	canEditPost,
	canManageThread,
	canModerate,
	canMoveThread,
	canReplyToThread,
	type decodeHighlight,
	type getThreadBadges,
} from "@ellie/types";
import type { User } from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrichedPost extends Post {
	author: User | null;
	attachments: Attachment[];
	canDelete: boolean;
	canEdit: boolean;
}

export interface ThreadDetailData {
	thread: Thread;
	badges: ReturnType<typeof getThreadBadges>;
	highlight: ReturnType<typeof decodeHighlight>;
	posts: EnrichedPost[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
	canReply: boolean;
	canModerateForum: boolean;
	/** Can manage thread (sticky/highlight/digest/close) */
	canManageThread: boolean;
	/** Can move thread to another forum (SuperMod/Admin only) */
	canMoveThread: boolean;
	/** Can delete thread (SuperMod/Admin or author) */
	canDeleteThread: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Extract unique author IDs from a post list. */
export function uniqueAuthorIds(posts: Post[]): number[] {
	return [...new Set(posts.map((p) => p.authorId))];
}

/** Group attachments by their postId. */
export function groupAttachmentsByPostId(attachments: Attachment[]): Map<number, Attachment[]> {
	const map = new Map<number, Attachment[]>();
	for (const att of attachments) {
		const list = map.get(att.postId) ?? [];
		list.push(att);
		map.set(att.postId, list);
	}
	return map;
}

/** Enrich posts with author info, attachments, and permission flags. */
export function enrichPosts(
	posts: Post[],
	authorMap: Map<number, User>,
	attachmentMap: Map<number, Attachment[]>,
	currentUser: User | null,
	forum: { moderators: string },
): EnrichedPost[] {
	return posts.map((post) => {
		const author = authorMap.get(post.authorId) ?? null;
		return {
			...post,
			content: filterContent(post.content),
			author: author ? { ...author, signature: filterContent(author.signature ?? "") } : null,
			attachments: attachmentMap.get(post.id) ?? [],
			canDelete: canDeletePost(currentUser, post, forum),
			canEdit: canEditPost(currentUser, post, forum),
		};
	});
}

/** Check if a user can reply to a thread. */
export function checkCanReply(user: User | null, thread: Thread): boolean {
	return canReplyToThread(user, thread);
}

/** Check if a user can moderate in a forum. */
export function checkCanModerate(user: User | null, forum: { moderators: string }): boolean {
	return canModerate(user, forum);
}

/** Check if a user can manage thread (sticky/highlight/digest/close). */
export function checkCanManageThread(user: User | null, forum: { moderators: string }): boolean {
	return canManageThread(user, forum);
}

/** Check if a user can move thread (SuperMod/Admin only). */
export function checkCanMoveThread(user: User | null): boolean {
	return canMoveThread(user);
}

/** Check if a user can delete thread (SuperMod/Admin or author). */
export function checkCanDeleteThread(
	user: User | null,
	thread: { authorId: number },
	forum: { moderators: string },
): boolean {
	return canDeleteThread(user, thread, forum);
}

/** Get the floor number display text. */
export function floorLabel(position: number, isFirst: boolean): string {
	if (isFirst) return "楼主";
	return `${position} 楼`;
}

/** Format file size for display. */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Re-export shared date formatters used by thread-detail views
export { formatDate, formatDateTime } from "@/viewmodels/shared/formatting";
