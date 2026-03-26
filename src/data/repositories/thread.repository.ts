// data/repositories/thread.repository.ts — Mock ThreadRepository implementation
// Ref: 04a §ThreadRepository

import { MOCK_POSTS } from "@/data/mock/posts";
import { MOCK_THREADS } from "@/data/mock/threads";
import { encodeCursor } from "@/models/pagination";
import type { Thread } from "@/models/types";
import { StickyLevel } from "@/models/types";
import type {
	CreateThreadInput,
	PaginatedResult,
	ThreadListParams,
	ThreadRepository,
	ThreadSearchParams,
} from "./types";

export function createMockThreadRepository(): ThreadRepository {
	const threads: Thread[] = MOCK_THREADS.map((t) => ({ ...t }));
	let nextId = Math.max(...threads.map((t) => t.id)) + 1;

	function paginate(items: Thread[], limit: number): PaginatedResult<Thread> {
		const page = items.slice(0, limit);
		return {
			items: page,
			nextCursor:
				page.length === limit && items.length > limit
					? encodeCursor({
							sortValue: page[page.length - 1].lastPostAt,
							id: page[page.length - 1].id,
						})
					: null,
			prevCursor: null,
			total: items.length,
		};
	}

	return {
		async list(params: ThreadListParams): Promise<PaginatedResult<Thread>> {
			let filtered = [...threads];

			if (params.forumId !== undefined)
				filtered = filtered.filter((t) => t.forumId === params.forumId);
			if (params.authorId !== undefined)
				filtered = filtered.filter((t) => t.authorId === params.authorId);
			if (params.digest) filtered = filtered.filter((t) => t.digest > 0);
			if (params.createdAfter !== undefined)
				filtered = filtered.filter((t) => t.createdAt >= params.createdAfter!);

			// Sort
			const sort = params.sort ?? "latest";
			if (sort === "latest") filtered.sort((a, b) => b.lastPostAt - a.lastPostAt);
			else if (sort === "newest") filtered.sort((a, b) => b.createdAt - a.createdAt);
			else if (sort === "hot") filtered.sort((a, b) => b.replies - a.replies);

			const limit = params.limit ?? 20;
			return paginate(filtered, limit);
		},

		async search(params: ThreadSearchParams): Promise<PaginatedResult<Thread>> {
			if (!params.titlePrefix && !params.authorName) {
				throw new Error("search requires titlePrefix or authorName");
			}

			let filtered = [...threads];
			if (params.titlePrefix)
				filtered = filtered.filter((t) => t.subject.startsWith(params.titlePrefix!));
			if (params.authorName) filtered = filtered.filter((t) => t.authorName === params.authorName);

			filtered.sort((a, b) => b.createdAt - a.createdAt);
			const limit = params.limit ?? 20;
			return paginate(filtered, limit);
		},

		async getById(id: number): Promise<Thread | null> {
			return threads.find((t) => t.id === id) ?? null;
		},

		async create(input: CreateThreadInput): Promise<Thread> {
			const id = nextId++;
			const now = Math.floor(Date.now() / 1000);
			const thread: Thread = {
				id,
				forumId: input.forumId,
				authorId: 0, // would come from auth context
				authorName: "anonymous",
				subject: input.subject,
				createdAt: now,
				lastPostAt: now,
				lastPoster: "anonymous",
				replies: 0,
				views: 0,
				closed: 0,
				sticky: StickyLevel.None,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
			};
			threads.push(thread);

			// Also create the first post
			MOCK_POSTS.push({
				id: nextId++,
				threadId: id,
				forumId: input.forumId,
				authorId: 0,
				authorName: "anonymous",
				content: input.content,
				createdAt: now,
				isFirst: true,
				position: 1,
			});

			return thread;
		},

		async delete(id: number): Promise<void> {
			const idx = threads.findIndex((t) => t.id === id);
			if (idx === -1) throw new Error(`Thread ${id} not found`);
			threads.splice(idx, 1);
		},

		async setSticky(id: number, level: StickyLevel): Promise<void> {
			const thread = threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.sticky = level;
		},

		async setDigest(id: number, level: number): Promise<void> {
			const thread = threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.digest = level;
		},

		async setClosed(id: number, closed: boolean): Promise<void> {
			const thread = threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.closed = closed ? 1 : 0;
		},

		async move(id: number, targetForumId: number): Promise<void> {
			const thread = threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.forumId = targetForumId;
		},
	};
}
