// viewmodels/forum/thread-detail.ts — Thread detail ViewModel
// Ref: 04d §帖子详情 — enriched posts, attachment grouping, permissions

import {
	type Attachment,
	type Post,
	type Thread,
	canDeletePost,
	canModerate,
	canReplyToThread,
	type decodeHighlight,
	type getThreadBadges,
} from "@ellie/types";
import type { User } from "@ellie/types";
import { replaceSmileyCodesWithImages } from "@/lib/smiley";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrichedPost extends Post {
	author: User | null;
	attachments: Attachment[];
	canDelete: boolean;
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
	forumId: number,
): EnrichedPost[] {
	return posts.map((post) => {
		const author = authorMap.get(post.authorId) ?? null;
		return {
			...post,
			content: replaceSmileyCodesWithImages(post.content),
			author: author
				? { ...author, signature: replaceSmileyCodesWithImages(author.signature ?? "") }
				: null,
			attachments: attachmentMap.get(post.id) ?? [],
			canDelete: canDeletePost(currentUser, post, forumId),
		};
	});
}

/** Check if a user can reply to a thread. */
export function checkCanReply(user: User | null, thread: Thread): boolean {
	return canReplyToThread(user, thread);
}

/** Check if a user can moderate in a forum. */
export function checkCanModerate(user: User | null, forumId: number): boolean {
	return canModerate(user, forumId);
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

/** Absolute date "2003-7-14" (no zero-padding, Chinese locale style). */
export function formatDate(timestamp: number): string {
	if (timestamp === 0) return "";
	const d = new Date(timestamp * 1000);
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Absolute date-time "2013-5-19 23:40" (no zero-padding). */
export function formatDateTime(timestamp: number): string {
	if (timestamp === 0) return "";
	const d = new Date(timestamp * 1000);
	const m = d.getMinutes().toString().padStart(2, "0");
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${m}`;
}
