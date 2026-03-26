// data/index.ts — Repository factory
// Ref: 04a §Repository Factory, 04b §3 MVVM
// Creates a shared MockDataStore and passes it to all repositories,
// ensuring cross-repo state consistency (e.g. thread.create → post repo sees the new post).
// Phase 2: switch to API implementations when Worker is ready.

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

export function createRepositories(): Repositories {
	const store = createMockDataStore();
	return {
		forums: createMockForumRepository(store),
		threads: createMockThreadRepository(store),
		posts: createMockPostRepository(store),
		users: createMockUserRepository(store),
		attachments: createMockAttachmentRepository(store),
		_store: store,
	};
}
