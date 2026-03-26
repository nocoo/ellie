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

/** Fetch posts for content moderation (aggregates across threads) */
export async function fetchPosts(
	repos: Repositories,
	forumId: number | null,
	cursor?: string,
	direction?: "forward" | "backward",
	limit = 20,
): Promise<PaginatedResult<Post>> {
	// Get threads to aggregate posts from
	const threadResult =
		forumId !== null
			? await repos.threads.list({ forumId, limit: 250 })
			: await repos.threads.list({ limit: 250 });

	if (threadResult.items.length === 0) {
		return { items: [], nextCursor: null, prevCursor: null, total: 0 };
	}

	// Aggregate posts across all threads
	const allPosts: Post[] = [];
	for (const thread of threadResult.items) {
		const posts = await repos.posts.list({ threadId: thread.id, limit: 250 });
		allPosts.push(...posts.items);
	}

	// Sort by createdAt descending (newest first for moderation review)
	allPosts.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);

	// Manual cursor-based pagination over the aggregated list
	let page = allPosts;
	if (cursor) {
		const cursorId = Number(cursor);
		if (!Number.isNaN(cursorId)) {
			const idx = page.findIndex((p) => p.id === cursorId);
			if (idx !== -1) {
				page =
					direction === "backward"
						? page.slice(Math.max(0, idx - limit), idx)
						: page.slice(idx + 1);
			}
		}
	}

	const sliced = page.slice(0, limit);
	const nextCursor =
		sliced.length === limit && page.length > limit ? String(sliced[sliced.length - 1].id) : null;
	const prevCursor = cursor && sliced.length > 0 ? String(sliced[0].id) : null;

	return { items: sliced, nextCursor, prevCursor, total: allPosts.length };
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
