// data/repositories/thread.repository.ts — Mock ThreadRepository implementation
// Ref: 04a §ThreadRepository

import type { MockDataStore } from "@/data/mock/store";
import { decodeCursor, encodeCursor } from "@/models/pagination";
import type { Thread } from "@/models/types";
import { StickyLevel } from "@/models/types";
import type {
	CreateThreadInput,
	PaginatedResult,
	ThreadListParams,
	ThreadRepository,
	ThreadSearchParams,
} from "./types";

type SortKey = "lastPostAt" | "createdAt" | "replies";

function getSortKey(sort: "latest" | "newest" | "hot"): SortKey {
	if (sort === "newest") return "createdAt";
	if (sort === "hot") return "replies";
	return "lastPostAt";
}

function paginateCursor(
	sorted: Thread[],
	sortKey: SortKey,
	limit: number,
	cursor?: string,
	direction: "forward" | "backward" = "forward",
): PaginatedResult<Thread> {
	let filtered = sorted;

	if (cursor) {
		const payload = decodeCursor(cursor);
		if (payload) {
			if (direction === "forward") {
				filtered = sorted.filter(
					(t) =>
						t[sortKey] < payload.sortValue ||
						(t[sortKey] === payload.sortValue && t.id < payload.id),
				);
			} else {
				filtered = sorted.filter(
					(t) =>
						t[sortKey] > payload.sortValue ||
						(t[sortKey] === payload.sortValue && t.id > payload.id),
				);
				// Backward: we filtered items "before" the cursor in reverse order,
				// but we still want them in descending order, so reverse then take last N
				filtered = filtered.slice(-limit);
			}
		}
	}

	const page = direction === "backward" ? filtered.slice(0, limit) : filtered.slice(0, limit);

	const nextCursor =
		page.length === limit && filtered.length > limit
			? encodeCursor({ sortValue: page[page.length - 1][sortKey], id: page[page.length - 1].id })
			: null;

	const prevCursor =
		cursor && page.length > 0
			? encodeCursor({ sortValue: page[0][sortKey], id: page[0].id })
			: null;

	return { items: page, nextCursor, prevCursor, total: sorted.length };
}

export function createMockThreadRepository(store: MockDataStore): ThreadRepository {
	return {
		async list(params: ThreadListParams): Promise<PaginatedResult<Thread>> {
			let filtered = [...store.threads];

			if (params.forumId !== undefined)
				filtered = filtered.filter((t) => t.forumId === params.forumId);
			if (params.authorId !== undefined)
				filtered = filtered.filter((t) => t.authorId === params.authorId);
			if (params.digest) filtered = filtered.filter((t) => t.digest > 0);
			if (params.createdAfter !== undefined)
				filtered = filtered.filter((t) => t.createdAt >= params.createdAfter!);

			const sort = params.sort ?? "latest";
			const sortKey = getSortKey(sort);
			// Descending sort
			filtered.sort((a, b) => b[sortKey] - a[sortKey] || b.id - a.id);

			const limit = params.limit ?? 20;
			return paginateCursor(filtered, sortKey, limit, params.cursor, params.direction);
		},

		async search(params: ThreadSearchParams): Promise<PaginatedResult<Thread>> {
			if (!params.titlePrefix && !params.authorName) {
				throw new Error("search requires titlePrefix or authorName");
			}

			let filtered = [...store.threads];
			if (params.titlePrefix)
				filtered = filtered.filter((t) => t.subject.startsWith(params.titlePrefix!));
			if (params.authorName) filtered = filtered.filter((t) => t.authorName === params.authorName);

			filtered.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);
			const limit = params.limit ?? 20;
			return paginateCursor(filtered, "createdAt", limit, params.cursor, params.direction);
		},

		async getById(id: number): Promise<Thread | null> {
			return store.threads.find((t) => t.id === id) ?? null;
		},

		async create(input: CreateThreadInput): Promise<Thread> {
			const id = store.nextId();
			const now = Math.floor(Date.now() / 1000);
			const thread: Thread = {
				id,
				forumId: input.forumId,
				authorId: input.authorId,
				authorName: input.authorName,
				subject: input.subject,
				createdAt: now,
				lastPostAt: now,
				lastPoster: input.authorName,
				replies: 0,
				views: 0,
				closed: 0,
				sticky: StickyLevel.None,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
			};
			store.threads.push(thread);

			// Create the first post in the shared store
			store.posts.push({
				id: store.nextId(),
				threadId: id,
				forumId: input.forumId,
				authorId: input.authorId,
				authorName: input.authorName,
				content: input.content,
				createdAt: now,
				isFirst: true,
				position: 1,
			});

			return thread;
		},

		async delete(id: number): Promise<void> {
			const idx = store.threads.findIndex((t) => t.id === id);
			if (idx === -1) throw new Error(`Thread ${id} not found`);
			store.threads.splice(idx, 1);
			// Cascade: remove all posts belonging to this thread
			for (let i = store.posts.length - 1; i >= 0; i--) {
				if (store.posts[i].threadId === id) {
					store.posts.splice(i, 1);
				}
			}
		},

		async setSticky(id: number, level: StickyLevel): Promise<void> {
			const thread = store.threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.sticky = level;
		},

		async setDigest(id: number, level: number): Promise<void> {
			const thread = store.threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.digest = level;
		},

		async setClosed(id: number, closed: boolean): Promise<void> {
			const thread = store.threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.closed = closed ? 1 : 0;
		},

		async move(id: number, targetForumId: number): Promise<void> {
			const thread = store.threads.find((t) => t.id === id);
			if (!thread) throw new Error(`Thread ${id} not found`);
			thread.forumId = targetForumId;
			// Sync: update forumId on all posts belonging to this thread
			for (const post of store.posts) {
				if (post.threadId === id) {
					post.forumId = targetForumId;
				}
			}
		},
	};
}
