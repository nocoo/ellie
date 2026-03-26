// viewmodels/forum/thread-detail.ts — Thread detail page ViewModel
// Ref: 04d §帖子详情 — thread + posts + attachments + permissions

import type { Repositories } from "@/data/index";
import type { PaginatedResult } from "@/data/repositories/types";
import { attachmentUrl, thumbnailUrl } from "@/lib/attachment";
import { getThreadBadges } from "@/models/thread";
import type { ThreadBadge } from "@/models/thread";
import type { Attachment, Post, Thread, User } from "@/models/types";

// ─── Types ─────────────────────────────────────────────

export interface PostItem {
	post: Post;
	author: User | null;
	attachments: Attachment[];
}

export interface ThreadDetailData {
	thread: Thread;
	badges: ThreadBadge[];
	forum: { id: number; name: string } | null;
	posts: PostItem[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

// ─── Pure Functions ────────────────────────────────────

/**
 * Group attachments by postId.
 * Pure function, exported for testing.
 */
export function groupAttachmentsByPost(attachments: Attachment[]): Map<number, Attachment[]> {
	const map = new Map<number, Attachment[]>();
	for (const att of attachments) {
		const list = map.get(att.postId);
		if (list) {
			list.push(att);
		} else {
			map.set(att.postId, [att]);
		}
	}
	return map;
}

/**
 * Resolve an attachment to display URLs.
 * Pure function, exported for testing.
 */
export function resolveAttachmentUrls(att: Attachment): {
	url: string;
	thumbUrl: string | null;
} {
	return {
		url: attachmentUrl(att.filePath),
		thumbUrl: att.hasThumb ? thumbnailUrl(att.filePath) : null,
	};
}

// ─── ViewModel ─────────────────────────────────────────

/**
 * Fetch thread detail: thread metadata + paginated posts + attachments + authors.
 */
export async function fetchThreadDetail(
	repos: Repositories,
	threadId: number,
	options: {
		cursor?: string;
		direction?: "forward" | "backward";
		limit?: number;
	} = {},
): Promise<ThreadDetailData | null> {
	const thread = await repos.threads.getById(threadId);
	if (!thread) return null;

	const forum = await repos.forums.getById(thread.forumId);

	const postResult: PaginatedResult<Post> = await repos.posts.list({
		threadId,
		cursor: options.cursor,
		direction: options.direction,
		limit: options.limit ?? 20,
	});

	// Fetch attachments for all posts in this page
	const allAttachments = await repos.attachments.listByThreadId(threadId);
	const attachmentsByPost = groupAttachmentsByPost(allAttachments);

	// Fetch unique author info for posts on this page
	const authorIds = [...new Set(postResult.items.map((p) => p.authorId))];
	const authors = new Map<number, User | null>();
	await Promise.all(
		authorIds.map(async (id) => {
			const user = await repos.users.getById(id);
			authors.set(id, user);
		}),
	);

	const posts: PostItem[] = postResult.items.map((post) => ({
		post,
		author: authors.get(post.authorId) ?? null,
		attachments: attachmentsByPost.get(post.id) ?? [],
	}));

	return {
		thread,
		badges: getThreadBadges(thread),
		forum: forum ? { id: forum.id, name: forum.name } : null,
		posts,
		nextCursor: postResult.nextCursor,
		prevCursor: postResult.prevCursor,
		total: postResult.total,
	};
}
