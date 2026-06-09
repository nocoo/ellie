import { describe, expect, it } from "vitest";
import type { Post } from "@/viewmodels/admin/posts";
import { enrichPosts, uniqueAuthorIds } from "@/viewmodels/admin/thread-detail";
import type { User } from "@/viewmodels/admin/users";

describe("thread-detail", () => {
	const basePost: Post = {
		id: 1,
		threadId: 1,
		forumId: 1,
		content: "hello",
		authorId: 10,
		authorName: "alice",
		isFirst: true,
		position: 1,
		createdAt: 1000,
	};

	const baseUser: User = {
		id: 10,
		username: "alice",
		email: "a@x.com",
		avatar: "",
		role: 0,
		status: 0,
		threads: 0,
		posts: 0,
		credits: 0,
		regDate: 0,
		lastLogin: 0,
	};

	describe("uniqueAuthorIds", () => {
		it("extracts unique author IDs", () => {
			const posts = [
				{ ...basePost, id: 1, authorId: 10 },
				{ ...basePost, id: 2, authorId: 20 },
				{ ...basePost, id: 3, authorId: 10 },
			];
			const ids = uniqueAuthorIds(posts);
			expect(ids).toEqual([10, 20]);
		});

		it("returns empty for empty posts", () => {
			expect(uniqueAuthorIds([])).toEqual([]);
		});
	});

	describe("enrichPosts", () => {
		it("maps authors to posts", () => {
			const posts = [
				{ ...basePost, id: 1, authorId: 10 },
				{ ...basePost, id: 2, authorId: 20 },
			];
			const authors = [
				{ ...baseUser, id: 10, username: "alice" },
				{ ...baseUser, id: 20, username: "bob" },
			];
			const result = enrichPosts(posts, authors);
			expect(result[0].author?.username).toBe("alice");
			expect(result[1].author?.username).toBe("bob");
		});

		it("sets author to null for unknown authorId", () => {
			const posts = [{ ...basePost, id: 1, authorId: 999 }];
			const result = enrichPosts(posts, []);
			expect(result[0].author).toBeNull();
		});
	});
});
