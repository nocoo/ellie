import { describe, expect, it } from "bun:test";
import type { Post } from "../../../../apps/web/src/viewmodels/admin/posts";
import {
	enrichPosts,
	uniqueAuthorIds,
} from "../../../../apps/web/src/viewmodels/admin/thread-detail";
import type { User } from "../../../../apps/web/src/viewmodels/admin/users";

function makePost(overrides: Partial<Post> = {}): Post {
	return {
		id: 1,
		threadId: 100,
		forumId: 10,
		content: "Hello world",
		authorId: 42,
		authorName: "alice",
		isFirst: false,
		position: 1,
		createdAt: 1700000000,
		...overrides,
	};
}

function makeUser(overrides: Partial<User> = {}): User {
	return {
		id: 42,
		username: "alice",
		email: "alice@example.com",
		avatar: "https://example.com/alice.jpg",
		role: 0,
		status: 0,
		threads: 10,
		posts: 100,
		credits: 50,
		regDate: 1600000000,
		lastLogin: 1700000000,
		...overrides,
	};
}

describe("uniqueAuthorIds", () => {
	it("returns unique author IDs", () => {
		const posts = [
			makePost({ authorId: 1 }),
			makePost({ authorId: 2 }),
			makePost({ authorId: 1 }),
			makePost({ authorId: 3 }),
		];
		expect(uniqueAuthorIds(posts).sort()).toEqual([1, 2, 3]);
	});

	it("returns empty for no posts", () => {
		expect(uniqueAuthorIds([])).toEqual([]);
	});

	it("returns single ID for one post", () => {
		expect(uniqueAuthorIds([makePost({ authorId: 99 })])).toEqual([99]);
	});
});

describe("enrichPosts", () => {
	it("attaches matching author to each post", () => {
		const posts = [makePost({ id: 1, authorId: 42 }), makePost({ id: 2, authorId: 43 })];
		const authors = [
			makeUser({ id: 42, username: "alice" }),
			makeUser({ id: 43, username: "bob" }),
		];

		const enriched = enrichPosts(posts, authors);
		expect(enriched).toHaveLength(2);
		expect(enriched[0]?.author?.username).toBe("alice");
		expect(enriched[1]?.author?.username).toBe("bob");
	});

	it("sets author to null for unknown authorId", () => {
		const posts = [makePost({ authorId: 999 })];
		const authors = [makeUser({ id: 42 })];

		const enriched = enrichPosts(posts, authors);
		expect(enriched[0]?.author).toBeNull();
	});

	it("preserves all post fields", () => {
		const post = makePost({ id: 5, content: "test content", position: 3, isFirst: true });
		const enriched = enrichPosts([post], [makeUser({ id: 42 })]);

		expect(enriched[0]?.id).toBe(5);
		expect(enriched[0]?.content).toBe("test content");
		expect(enriched[0]?.position).toBe(3);
		expect(enriched[0]?.isFirst).toBe(true);
	});

	it("handles empty posts array", () => {
		expect(enrichPosts([], [makeUser()])).toEqual([]);
	});

	it("handles empty authors array", () => {
		const enriched = enrichPosts([makePost()], []);
		expect(enriched[0]?.author).toBeNull();
	});

	it("multiple posts same author share same reference", () => {
		const posts = [makePost({ id: 1, authorId: 42 }), makePost({ id: 2, authorId: 42 })];
		const authors = [makeUser({ id: 42 })];

		const enriched = enrichPosts(posts, authors);
		expect(enriched[0]?.author).toBe(enriched[1]?.author);
	});
});
