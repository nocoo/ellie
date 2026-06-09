// viewmodels/forum/thread-detail.ts — Thread detail ViewModel
// Ref: 04d §主题详情 — enriched posts, attachment grouping, permissions

import type { User } from "@ellie/types";
import {
	type Attachment,
	canDeletePost,
	canDeleteThread,
	canEditPost,
	canEditThreadSubject,
	canManageThread,
	canModerate,
	canMoveThread,
	canReplyToThread,
	type decodeHighlight,
	type getThreadBadges,
	type Post,
	type PostComment,
	type Thread,
	UserRole,
	UserStatus,
} from "@ellie/types";
import { filterContent } from "@/lib/content-filter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EnrichedPost extends Post {
	author: User | null;
	attachments: Attachment[];
	/**
	 * Post comments (点评) loaded via SSR batch.
	 * - `PostComment[]` — batch succeeded (may be empty array if no comments).
	 * - `undefined`     — batch failed; client should refetch via /api/v1/post-comments?postId=…
	 *
	 * Distinguishing "[]" (empty success) from "undefined" (failure) is what
	 * lets PostComments fall back to a client-side fetch when SSR can't reach
	 * the worker, instead of silently rendering an empty list (regression
	 * from the L3 e2e failure investigation).
	 */
	comments: PostComment[] | undefined;
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
	/** Can delete thread (SuperMod/Admin only in UI) */
	canDeleteThread: boolean;
	/** Can edit thread subject (author on open thread, or moderator/admin) */
	canEditSubject: boolean;
}

/**
 * Check if a user can edit a thread's subject.
 *
 * Mirrors the worker-side `canEditThreadSubject` permission:
 *   - moderator (Admin/SuperMod/Mod-in-forum) always allowed
 *   - else active author on a non-closed thread
 *
 * Used by `thread-detail.server.ts` to gate the Pencil pen icon (PC only).
 */
export function checkCanEditSubject(
	user: User | null,
	thread: { id: number; authorId: number; closed: number },
	forum: { moderators: string },
): boolean {
	return canEditThreadSubject(user, thread, forum);
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

/** Group comments by their postId. */
export function groupCommentsByPostId(comments: PostComment[]): Map<number, PostComment[]> {
	const map = new Map<number, PostComment[]>();
	for (const comment of comments) {
		const list = map.get(comment.postId) ?? [];
		list.push(comment);
		map.set(comment.postId, list);
	}
	return map;
}

/**
 * Build a minimal author Map from post rows when the `/users/batch` SSR
 * batch fails. We only populate fields already present on the `Post` row
 * (id, username) — every other field is filled with safe, non-sensitive
 * defaults. Posts whose row lacks an `authorName` are intentionally omitted
 * so `enrichPosts` falls back to `author: null` (renders "未知用户" stub)
 * rather than fabricating identity. This keeps the `<Link href="/users/N">`
 * author link rendering, which is the contract E2E-PO-01 asserts.
 */
export function buildFallbackAuthorMap(posts: Post[]): Map<number, User> {
	const map = new Map<number, User>();
	for (const post of posts) {
		if (map.has(post.authorId)) continue;
		if (!post.authorName) continue;
		map.set(post.authorId, {
			id: post.authorId,
			username: post.authorName,
			email: "",
			avatar: "",
			avatarPath: "",
			status: UserStatus.Active,
			role: UserRole.User,
			regDate: 0,
			lastLogin: 0,
			threads: 0,
			posts: 0,
			credits: 0,
			coins: 0,
			signature: "",
			groupTitle: "",
			groupStars: 0,
			groupColor: "",
			customTitle: "",
			digestPosts: 0,
			olTime: 0,
			gender: 0,
			birthYear: 0,
			birthMonth: 0,
			birthDay: 0,
			resideProvince: "",
			resideCity: "",
			graduateSchool: "",
			bio: "",
			interest: "",
			qq: "",
			site: "",
			campus: "",
			checkin: null,
			lastActivity: 0,
			emailVerifiedAt: 0,
			emailNormalized: "",
			emailChangedAt: 0,
			purgedAt: 0,
			purgedBy: 0,
		});
	}
	return map;
}

/** Enrich posts with author info, attachments, comments, and permission flags. */
export function enrichPosts(
	posts: Post[],
	authorMap: Map<number, User>,
	attachmentMap: Map<number, Attachment[]>,
	/**
	 * Comments grouped by postId. `undefined` signals that the SSR batch
	 * fetch FAILED (vs. an empty Map which means the batch succeeded with no
	 * comments). When `undefined`, every post gets `comments: undefined` so
	 * the client component can fall back to its own fetch path.
	 */
	commentMap: Map<number, PostComment[]> | undefined,
	currentUser: User | null,
	forum: { moderators: string },
): EnrichedPost[] {
	return posts.map((post) => {
		const author = authorMap.get(post.authorId) ?? null;
		// `commentMap === undefined` → SSR batch failed → propagate undefined so
		// PostComments triggers a client-side refetch.
		// `commentMap.get(post.id) ?? []` → batch succeeded; missing key just
		// means this post has no comments, render the empty state.
		const comments = commentMap === undefined ? undefined : (commentMap.get(post.id) ?? []);
		return {
			...post,
			content: filterContent(post.content),
			author: author ? { ...author, signature: filterContent(author.signature ?? "") } : null,
			attachments: attachmentMap.get(post.id) ?? [],
			comments,
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
