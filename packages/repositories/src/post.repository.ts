// data/repositories/post.repository.ts — Mock PostRepository implementation
// Ref: 04a §PostRepository

import { decodeCursor, encodeCursor } from "@ellie/types";
import type { Post } from "@ellie/types";
import type { MockDataStore } from "./mock/store";
import type { CreatePostInput, PaginatedResult, PostListParams, PostRepository } from "./types";

export function createMockPostRepository(store: MockDataStore): PostRepository {
	return {
		async list(params: PostListParams): Promise<PaginatedResult<Post>> {
			if (!params.threadId && !params.authorId) {
				throw new Error("list requires threadId or authorId");
			}

			let filtered = [...store.posts];
			if (params.threadId !== undefined)
				filtered = filtered.filter((p) => p.threadId === params.threadId);
			if (params.authorId !== undefined)
				filtered = filtered.filter((p) => p.authorId === params.authorId);

			// Sort by position ascending (thread view)
			filtered.sort((a, b) => a.position - b.position || a.id - b.id);

			const limit = params.limit ?? 20;

			// Cursor-based pagination
			let page = filtered;
			if (params.cursor) {
				const payload = decodeCursor(params.cursor);
				if (payload) {
					if (params.direction === "backward") {
						page = filtered.filter(
							(p) =>
								p.position < payload.sortValue ||
								(p.position === payload.sortValue && p.id < payload.id),
						);
						page = page.slice(-limit);
					} else {
						page = filtered.filter(
							(p) =>
								p.position > payload.sortValue ||
								(p.position === payload.sortValue && p.id > payload.id),
						);
					}
				}
			}

			const sliced = page.slice(0, limit);
			const nextCursor =
				sliced.length === limit && page.length > limit
					? encodeCursor({
							sortValue: sliced[sliced.length - 1].position,
							id: sliced[sliced.length - 1].id,
						})
					: null;
			const prevCursor =
				params.cursor && sliced.length > 0
					? encodeCursor({ sortValue: sliced[0].position, id: sliced[0].id })
					: null;

			return { items: sliced, nextCursor, prevCursor, total: filtered.length };
		},

		async create(input: CreatePostInput): Promise<Post> {
			const threadPosts = store.posts.filter((p) => p.threadId === input.threadId);
			const maxPosition = threadPosts.reduce((max, p) => Math.max(max, p.position), 0);

			// Resolve forumId from thread
			const thread = store.threads.find((t) => t.id === input.threadId);
			const forumId = thread?.forumId ?? 0;

			const id = store.nextId();
			const now = Math.floor(Date.now() / 1000);
			const post: Post = {
				id,
				threadId: input.threadId,
				forumId,
				authorId: input.authorId,
				authorName: input.authorName,
				content: input.content,
				createdAt: now,
				isFirst: false,
				position: maxPosition + 1,
			};
			store.posts.push(post);

			// Update thread's reply count and last poster
			if (thread) {
				thread.replies++;
				thread.lastPostAt = now;
				thread.lastPoster = input.authorName;
			}

			return post;
		},

		async delete(id: number): Promise<void> {
			const idx = store.posts.findIndex((p) => p.id === id);
			if (idx === -1) throw new Error(`Post ${id} not found`);
			const deleted = store.posts[idx];
			store.posts.splice(idx, 1);

			// Update thread reply count and last post info
			const thread = store.threads.find((t) => t.id === deleted.threadId);
			if (thread && !deleted.isFirst) {
				thread.replies = Math.max(0, thread.replies - 1);
				// Recalculate lastPostAt and lastPoster from remaining posts
				const remaining = store.posts
					.filter((p) => p.threadId === deleted.threadId)
					.sort((a, b) => b.position - a.position);
				if (remaining.length > 0) {
					thread.lastPostAt = remaining[0].createdAt;
					thread.lastPoster = remaining[0].authorName;
				}
			}
		},
	};
}
