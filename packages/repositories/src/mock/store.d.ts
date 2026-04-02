import type { Attachment, Forum, Post, Thread, User } from "@ellie/types";
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
export declare function createMockDataStore(): MockDataStore;
