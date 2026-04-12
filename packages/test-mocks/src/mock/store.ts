// data/mock/store.ts — Shared mutable data store for all mock repositories
// Solves: cross-repo state consistency (thread.create → post repo sees the new post)

import type { Attachment, Forum, Post, Thread, User } from "@ellie/types";
import { MOCK_ATTACHMENTS } from "./attachments";
import { MOCK_FORUMS } from "./forums";
import { MOCK_POSTS } from "./posts";
import { MOCK_THREADS } from "./threads";
import { MOCK_USERS } from "./users";

export interface MockDataStore {
	users: User[];
	forums: Forum[];
	threads: Thread[];
	posts: Post[];
	attachments: Attachment[];
	nextId(): number;
}

/**
 * Create a fresh MockDataStore with cloned copies of all seed data.
 * All repos share the same store instance — mutations are visible everywhere.
 */
export function createMockDataStore(): MockDataStore {
	const allItems = [
		...MOCK_USERS,
		...MOCK_FORUMS,
		...MOCK_THREADS,
		...MOCK_POSTS,
		...MOCK_ATTACHMENTS,
	];
	let counter = Math.max(...allItems.map((item) => item.id)) + 1;

	return {
		users: MOCK_USERS.map((u) => ({ ...u })),
		forums: MOCK_FORUMS.map((f) => ({ ...f })),
		threads: MOCK_THREADS.map((t) => ({ ...t })),
		posts: MOCK_POSTS.map((p) => ({ ...p })),
		attachments: MOCK_ATTACHMENTS.map((a) => ({ ...a })),
		nextId() {
			return counter++;
		},
	};
}
