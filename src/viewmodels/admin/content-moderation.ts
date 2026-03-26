// viewmodels/admin/content-moderation.ts — Content Moderation ViewModel
// Ref: 04c §内容审核 — threads/posts tab, filter by forum, delete

import type { Repositories } from "@/data/index";
import type { PaginatedResult } from "@/data/repositories/types";
import type { Post, Thread } from "@/models/types";

export type ContentTab = "threads" | "posts";

export interface ContentModerationFilters {
	tab: ContentTab;
	forumId: number | null;
}

export interface ContentModerationActions {
	deleteThread(id: number): Promise<void>;
	deletePost(id: number): Promise<void>;
}

export const DEFAULT_CONTENT_FILTERS: ContentModerationFilters = {
	tab: "threads",
	forumId: null,
};

/** Fetch threads for content moderation */
export async function fetchThreads(
	repos: Repositories,
	forumId: number | null,
	cursor?: string,
	direction?: "forward" | "backward",
	limit = 20,
): Promise<PaginatedResult<Thread>> {
	return repos.threads.list({
		forumId: forumId ?? undefined,
		cursor,
		direction,
		limit,
		sort: "newest",
	});
}

/** Fetch posts for content moderation (requires forumId → threadId mapping, or list by author) */
export async function fetchPosts(
	repos: Repositories,
	forumId: number | null,
	cursor?: string,
	direction?: "forward" | "backward",
	limit = 20,
): Promise<PaginatedResult<Post>> {
	// If filtering by forum, get threads in that forum first, then list posts
	if (forumId !== null) {
		const threads = await repos.threads.list({ forumId, limit: 250 });
		if (threads.items.length === 0) {
			return { items: [], nextCursor: null, prevCursor: null, total: 0 };
		}
		// For simplicity in mock phase, list posts by first thread
		// A real implementation would aggregate across threads
		return repos.posts.list({
			threadId: threads.items[0].id,
			cursor,
			direction,
			limit,
		});
	}
	// Without forum filter, we need at least a threadId — use first thread
	const allThreads = await repos.threads.list({ limit: 1 });
	if (allThreads.items.length === 0) {
		return { items: [], nextCursor: null, prevCursor: null, total: 0 };
	}
	return repos.posts.list({
		threadId: allThreads.items[0].id,
		cursor,
		direction,
		limit,
	});
}

/** Create content moderation actions */
export function createContentActions(repos: Repositories): ContentModerationActions {
	return {
		async deleteThread(id: number) {
			await repos.threads.delete(id);
		},
		async deletePost(id: number) {
			await repos.posts.delete(id);
		},
	};
}
