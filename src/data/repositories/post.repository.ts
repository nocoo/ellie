// data/repositories/post.repository.ts — Mock PostRepository implementation
// Ref: 04a §PostRepository

import { MOCK_POSTS } from "@/data/mock/posts";
import { encodeCursor } from "@/models/pagination";
import type { Post } from "@/models/types";
import type { CreatePostInput, PaginatedResult, PostListParams, PostRepository } from "./types";

export function createMockPostRepository(): PostRepository {
	const posts: Post[] = MOCK_POSTS.map((p) => ({ ...p }));
	let nextId = Math.max(...posts.map((p) => p.id)) + 1;

	function paginate(items: Post[], limit: number): PaginatedResult<Post> {
		const page = items.slice(0, limit);
		return {
			items: page,
			nextCursor:
				page.length === limit && items.length > limit
					? encodeCursor({
							sortValue: page[page.length - 1].createdAt,
							id: page[page.length - 1].id,
						})
					: null,
			prevCursor: null,
			total: items.length,
		};
	}

	return {
		async list(params: PostListParams): Promise<PaginatedResult<Post>> {
			if (!params.threadId && !params.authorId) {
				throw new Error("list requires threadId or authorId");
			}

			let filtered = [...posts];
			if (params.threadId !== undefined)
				filtered = filtered.filter((p) => p.threadId === params.threadId);
			if (params.authorId !== undefined)
				filtered = filtered.filter((p) => p.authorId === params.authorId);

			// Sort by position (for thread view) or createdAt
			filtered.sort((a, b) => a.position - b.position);

			const limit = params.limit ?? 20;
			return paginate(filtered, limit);
		},

		async create(input: CreatePostInput): Promise<Post> {
			const threadPosts = posts.filter((p) => p.threadId === input.threadId);
			const maxPosition = threadPosts.reduce((max, p) => Math.max(max, p.position), 0);

			const id = nextId++;
			const now = Math.floor(Date.now() / 1000);
			const post: Post = {
				id,
				threadId: input.threadId,
				forumId: 0, // would be resolved from thread
				authorId: 0, // would come from auth context
				authorName: "anonymous",
				content: input.content,
				createdAt: now,
				isFirst: false,
				position: maxPosition + 1,
			};
			posts.push(post);
			return post;
		},

		async delete(id: number): Promise<void> {
			const idx = posts.findIndex((p) => p.id === id);
			if (idx === -1) throw new Error(`Post ${id} not found`);
			posts.splice(idx, 1);
		},
	};
}
