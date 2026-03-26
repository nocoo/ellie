// data/index.ts — Repository factory
// Ref: 04a §Repository Factory, 04b §3 MVVM
// Currently returns Mock implementations.
// Phase 2: switch to API implementations when Worker is ready.

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
}

export function createRepositories(): Repositories {
	return {
		forums: createMockForumRepository(),
		threads: createMockThreadRepository(),
		posts: createMockPostRepository(),
		users: createMockUserRepository(),
		attachments: createMockAttachmentRepository(),
	};
}
