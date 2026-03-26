// viewmodels/forum/thread-list.ts — Thread list page ViewModel
// Ref: 04d §版块帖子列表 — thread list with sort/filter/pagination

import type { Repositories } from "@ellie/repositories";
import type { PaginatedResult, ThreadListParams } from "@ellie/repositories";
import { type ThreadBadge, decodeHighlight, getThreadBadges } from "@ellie/types";
import type { HighlightStyle } from "@ellie/types";
import type { Forum, Thread } from "@ellie/types";

export interface ThreadListItem {
	thread: Thread;
	badges: ThreadBadge[];
	highlightStyle: HighlightStyle | null;
}

export type ThreadSort = "latest" | "newest" | "hot";

export interface ThreadListData {
	forum: Forum;
	items: ThreadListItem[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

/**
 * Enrich a thread with display metadata (badges + highlight).
 * Pure function, exported for testing.
 */
export function enrichThread(thread: Thread): ThreadListItem {
	return {
		thread,
		badges: getThreadBadges(thread),
		highlightStyle: decodeHighlight(thread.highlight),
	};
}

/**
 * Fetch thread list for a forum with sort/filter/pagination.
 */
export async function fetchThreadList(
	repos: Repositories,
	forumId: number,
	options: {
		sort?: ThreadSort;
		digestOnly?: boolean;
		cursor?: string;
		direction?: "forward" | "backward";
		limit?: number;
	} = {},
): Promise<ThreadListData | null> {
	const forum = await repos.forums.getById(forumId);
	if (!forum) return null;

	const params: ThreadListParams = {
		forumId,
		sort: options.sort ?? "latest",
		digest: options.digestOnly || undefined,
		cursor: options.cursor,
		direction: options.direction,
		limit: options.limit ?? 20,
	};

	const result: PaginatedResult<Thread> = await repos.threads.list(params);

	return {
		forum,
		items: result.items.map(enrichThread),
		nextCursor: result.nextCursor,
		prevCursor: result.prevCursor,
		total: result.total,
	};
}
