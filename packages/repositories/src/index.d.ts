import type { MockDataStore } from "./mock/store";
import type {
	AttachmentRepository,
	ForumRepository,
	PostRepository,
	ThreadRepository,
	UserRepository,
} from "./types";
export interface Repositories {
	forums: ForumRepository;
	threads: ThreadRepository;
	posts: PostRepository;
	users: UserRepository;
	attachments: AttachmentRepository;
	/** Exposed for auth integration — auth validates against live user data */
	_store: MockDataStore;
}
/**
 * Reset the singleton store. Used by tests to get a clean state.
 */
export declare function resetStore(): void;
export declare function createRepositories(): Repositories;
export * from "./types";
