// @ellie/repositories — Repository interfaces and implementations

import { createMockAttachmentRepository } from "./attachment.repository";
import { createMockForumRepository } from "./forum.repository";
import { type MockDataStore, createMockDataStore } from "./mock/store";
import { createMockPostRepository } from "./post.repository";
import { createMockThreadRepository } from "./thread.repository";
import type {
	AttachmentRepository,
	ForumRepository,
	PostRepository,
	ThreadRepository,
	UserRepository,
} from "./types";
import { createMockUserRepository } from "./user.repository";

export interface Repositories {
	forums: ForumRepository;
	threads: ThreadRepository;
	posts: PostRepository;
	users: UserRepository;
	attachments: AttachmentRepository;
	/** Exposed for auth integration — auth validates against live user data */
	_store: MockDataStore;
}

// ---------------------------------------------------------------------------
// Singleton store — one shared instance per server process.
// Mutations from any API route are visible to all subsequent requests.
// Reset only on server restart. Phase 2 replaces this with D1.
// ---------------------------------------------------------------------------
let _singleton: MockDataStore | null = null;

function getStore(): MockDataStore {
	if (!_singleton) {
		_singleton = createMockDataStore();
	}
	return _singleton;
}

/**
 * Reset the singleton store. Used by tests to get a clean state.
 */
export function resetStore(): void {
	_singleton = null;
}

export function createRepositories(): Repositories {
	const store = getStore();
	return {
		forums: createMockForumRepository(store),
		threads: createMockThreadRepository(store),
		posts: createMockPostRepository(store),
		users: createMockUserRepository(store),
		attachments: createMockAttachmentRepository(store),
		_store: store,
	};
}

// Export types
export * from "./types";
