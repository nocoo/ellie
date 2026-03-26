// data/index.ts — Repository factory
// Ref: 04a §Repository Factory, 04b §3 MVVM
//
// Module-level singleton MockDataStore ensures cross-request state
// persistence within a single server process. All repositories share
// the same backing arrays, so thread.create → post repo sees the new post,
// and mutations survive across multiple API requests.
//
// IMPORTANT: This is in-memory only — state is lost on server restart.
// Phase 2: replace with D1-backed repositories (state persists in DB).

import { type MockDataStore, createMockDataStore } from "./mock/store";
import { createMockAttachmentRepository } from "./repositories/attachment.repository";
import { createMockForumRepository } from "./repositories/forum.repository";
import { createMockPostRepository } from "./repositories/post.repository";
import { createMockThreadRepository } from "./repositories/thread.repository";
import type {
	AttachmentRepository,
	ForumRepository,
	PostRepository,
	ThreadRepository,
	UserRepository,
} from "./repositories/types";
import { createMockUserRepository } from "./repositories/user.repository";

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
