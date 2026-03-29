import type { PaginatedResponse, PaginationMeta } from "@/lib/api-client";
import { type Post, fetchPosts } from "./posts";
import { type Thread, fetchThread } from "./threads";
import { type User, fetchUsersByIds } from "./users";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Post enriched with full author profile. */
export interface EnrichedPost extends Post {
	author: User | null;
}

export interface ThreadDetailData {
	thread: Thread;
	posts: EnrichedPost[];
	pagination: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Merge author profiles into posts. Posts with unknown authors get `author: null`. */
export function enrichPosts(posts: Post[], authors: User[]): EnrichedPost[] {
	const authorMap = new Map(authors.map((u) => [u.id, u]));
	return posts.map((post) => ({
		...post,
		author: authorMap.get(post.authorId) ?? null,
	}));
}

/** Extract unique author IDs from a list of posts. */
export function uniqueAuthorIds(posts: Post[]): number[] {
	return [...new Set(posts.map((p) => p.authorId))];
}

// ---------------------------------------------------------------------------
// API orchestration
// ---------------------------------------------------------------------------

/** Fetch posts for a thread in floor order (position ASC). */
export async function fetchThreadPosts(
	threadId: number,
	page = 1,
	limit = 20,
): Promise<PaginatedResponse<Post>> {
	return fetchPosts({
		threadId,
		page,
		limit,
		sort: "position_asc",
	});
}

/** Load thread + enriched posts in parallel. */
export async function loadThreadDetail(
	threadId: number,
	page = 1,
	limit = 20,
): Promise<ThreadDetailData> {
	const [thread, postsResponse] = await Promise.all([
		fetchThread(threadId),
		fetchThreadPosts(threadId, page, limit),
	]);

	const authorIds = uniqueAuthorIds(postsResponse.data);
	const authors = await fetchUsersByIds(authorIds);
	const posts = enrichPosts(postsResponse.data, authors);

	return {
		thread,
		posts,
		pagination: {
			total: postsResponse.meta.total,
			page: postsResponse.meta.page,
			limit: postsResponse.meta.limit,
			pages: postsResponse.meta.pages,
		},
	};
}
