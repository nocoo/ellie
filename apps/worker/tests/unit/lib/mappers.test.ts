import { describe, expect, it } from "bun:test";
import {
	toAttachment,
	toForum,
	toPost,
	toPublicUser,
	toThread,
	toUser,
} from "../../../src/lib/mappers";

describe("D1 row mappers", () => {
	describe("toUser", () => {
		it("should map snake_case D1 row to camelCase User", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "alice@example.com",
				avatar: "avatar.png",
				status: 0,
				role: 1,
				reg_date: 1711540800,
				last_login: 1711544400,
				threads: 10,
				posts: 50,
				credits: 100,
			};

			const user = toUser(row);

			expect(user).toEqual({
				id: 1,
				username: "alice",
				email: "alice@example.com",
				avatar: "avatar.png",
				status: 0,
				role: 1,
				regDate: 1711540800,
				lastLogin: 1711544400,
				threads: 10,
				posts: 50,
				credits: 100,
			});
		});

		it("should strip password_hash and password_salt even if present", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "alice@example.com",
				avatar: "avatar.png",
				status: 0,
				role: 1,
				reg_date: 1711540800,
				last_login: 1711544400,
				threads: 10,
				posts: 50,
				credits: 100,
				password_hash: "secret_hash",
				password_salt: "secret_salt",
			};

			const user = toUser(row);

			// Explicitly constructed — no password fields should exist
			expect("passwordHash" in user).toBe(false);
			expect("passwordSalt" in user).toBe(false);
			expect("password_hash" in user).toBe(false);
			expect("password_salt" in user).toBe(false);
		});

		it("should output exactly 11 fields", () => {
			const row = {
				id: 1,
				username: "alice",
				email: "a@b.com",
				avatar: "",
				status: 0,
				role: 0,
				reg_date: 0,
				last_login: 0,
				threads: 0,
				posts: 0,
				credits: 0,
			};

			const user = toUser(row);
			expect(Object.keys(user)).toHaveLength(11);
		});
	});

	describe("toForum", () => {
		it("should map snake_case D1 row to camelCase Forum", () => {
			const row = {
				id: 1,
				parent_id: 0,
				name: "General",
				description: "General discussion",
				icon: "icon.png",
				display_order: 1,
				threads: 10,
				posts: 100,
				type: "forum",
				status: 0,
				last_thread_id: 42,
				last_post_at: 1711540800,
				last_poster: "bob",
			};

			const forum = toForum(row);

			expect(forum.parentId).toBe(0);
			expect(forum.displayOrder).toBe(1);
			expect(forum.lastThreadId).toBe(42);
			expect(forum.lastPostAt).toBe(1711540800);
			expect(forum.lastPoster).toBe("bob");
		});

		it("should output exactly 13 fields", () => {
			const row = {
				id: 1,
				parent_id: 0,
				name: "General",
				description: "",
				icon: "",
				display_order: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 0,
				last_thread_id: 0,
				last_post_at: 0,
				last_poster: "",
			};

			const forum = toForum(row);
			expect(Object.keys(forum)).toHaveLength(13);
		});
	});

	describe("toThread", () => {
		it("should map snake_case D1 row to camelCase Thread", () => {
			const row = {
				id: 1,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "Test Thread",
				created_at: 1711540800,
				last_post_at: 1711544400,
				last_poster: "bob",
				replies: 5,
				views: 42,
				closed: 0,
				sticky: 1,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 3,
				post_table_id: 1, // internal — must be stripped
			};

			const thread = toThread(row);

			expect(thread.forumId).toBe(10);
			expect(thread.authorId).toBe(100);
			expect(thread.authorName).toBe("alice");
			expect(thread.createdAt).toBe(1711540800);
			expect(thread.lastPostAt).toBe(1711544400);
			expect(thread.lastPoster).toBe("bob");
		});

		it("should strip post_table_id (internal field)", () => {
			const row = {
				id: 1,
				forum_id: 10,
				author_id: 100,
				author_name: "alice",
				subject: "Test",
				created_at: 0,
				last_post_at: 0,
				last_poster: "",
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
				post_table_id: 5,
			};

			const thread = toThread(row);
			expect("postTableId" in thread).toBe(false);
			expect("post_table_id" in thread).toBe(false);
		});

		it("should output exactly 16 fields", () => {
			const row = {
				id: 1,
				forum_id: 0,
				author_id: 0,
				author_name: "",
				subject: "",
				created_at: 0,
				last_post_at: 0,
				last_poster: "",
				replies: 0,
				views: 0,
				closed: 0,
				sticky: 0,
				digest: 0,
				special: 0,
				highlight: 0,
				recommends: 0,
			};

			const thread = toThread(row);
			expect(Object.keys(thread)).toHaveLength(16);
		});
	});

	describe("toPost", () => {
		it("should map snake_case D1 row to camelCase Post", () => {
			const row = {
				id: 1,
				thread_id: 10,
				forum_id: 5,
				author_id: 100,
				author_name: "alice",
				content: "Hello",
				created_at: 1711540800,
				is_first: 1,
				position: 1,
			};

			const post = toPost(row);

			expect(post.threadId).toBe(10);
			expect(post.forumId).toBe(5);
			expect(post.authorId).toBe(100);
			expect(post.authorName).toBe("alice");
			expect(post.createdAt).toBe(1711540800);
			expect(post.position).toBe(1);
		});

		it("should convert is_first INTEGER 1 to boolean true", () => {
			const row = {
				id: 1,
				thread_id: 10,
				forum_id: 5,
				author_id: 100,
				author_name: "alice",
				content: "Hello",
				created_at: 0,
				is_first: 1,
				position: 1,
			};

			const post = toPost(row);
			expect(post.isFirst).toBe(true);
		});

		it("should convert is_first INTEGER 0 to boolean false", () => {
			const row = {
				id: 2,
				thread_id: 10,
				forum_id: 5,
				author_id: 101,
				author_name: "bob",
				content: "Reply",
				created_at: 0,
				is_first: 0,
				position: 2,
			};

			const post = toPost(row);
			expect(post.isFirst).toBe(false);
		});

		it("should output exactly 9 fields", () => {
			const row = {
				id: 1,
				thread_id: 0,
				forum_id: 0,
				author_id: 0,
				author_name: "",
				content: "",
				created_at: 0,
				is_first: 0,
				position: 0,
			};

			const post = toPost(row);
			expect(Object.keys(post)).toHaveLength(9);
		});
	});

	describe("toPublicUser", () => {
		it("should map snake_case D1 row to camelCase PublicUser", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				role: 1,
				reg_date: 1711540800,
				threads: 10,
				posts: 50,
				credits: 100,
			};

			const user = toPublicUser(row);

			expect(user).toEqual({
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				role: 1,
				regDate: 1711540800,
				threads: 10,
				posts: 50,
				credits: 100,
			});
		});

		it("should not include sensitive fields even if present in row", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				role: 1,
				reg_date: 1711540800,
				threads: 10,
				posts: 50,
				credits: 100,
				email: "alice@example.com",
				status: 0,
				last_login: 1711544400,
				password_hash: "secret_hash",
				password_salt: "secret_salt",
			};

			const user = toPublicUser(row);

			expect("email" in user).toBe(false);
			expect("status" in user).toBe(false);
			expect("lastLogin" in user).toBe(false);
			expect("last_login" in user).toBe(false);
			expect("passwordHash" in user).toBe(false);
			expect("password_hash" in user).toBe(false);
		});

		it("should output exactly 8 fields", () => {
			const row = {
				id: 1,
				username: "alice",
				avatar: "",
				role: 0,
				reg_date: 0,
				threads: 0,
				posts: 0,
				credits: 0,
			};

			const user = toPublicUser(row);
			expect(Object.keys(user)).toHaveLength(8);
		});
	});

	describe("toAttachment", () => {
		it("should map snake_case D1 row to camelCase Attachment", () => {
			const row = {
				id: 1,
				thread_id: 10,
				post_id: 20,
				author_id: 100,
				filename: "photo.jpg",
				file_path: "/attachments/photo.jpg",
				file_size: 54321,
				is_image: 1,
				width: 1024,
				has_thumb: 1,
				downloads: 5,
				created_at: 1711540800,
			};

			const attachment = toAttachment(row);

			expect(attachment.threadId).toBe(10);
			expect(attachment.postId).toBe(20);
			expect(attachment.authorId).toBe(100);
			expect(attachment.filename).toBe("photo.jpg");
			expect(attachment.filePath).toBe("/attachments/photo.jpg");
			expect(attachment.fileSize).toBe(54321);
			expect(attachment.width).toBe(1024);
			expect(attachment.downloads).toBe(5);
			expect(attachment.createdAt).toBe(1711540800);
		});

		it("should convert is_image INTEGER 1 to boolean true", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "img.png",
				file_path: "/img.png",
				file_size: 100,
				is_image: 1,
				width: 640,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.isImage).toBe(true);
			expect(attachment.hasThumb).toBe(false);
		});

		it("should convert is_image INTEGER 0 to boolean false", () => {
			const row = {
				id: 2,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "doc.pdf",
				file_path: "/doc.pdf",
				file_size: 200,
				is_image: 0,
				width: 0,
				has_thumb: 0,
				downloads: 10,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(attachment.isImage).toBe(false);
			expect(attachment.hasThumb).toBe(false);
		});

		it("should output exactly 12 fields", () => {
			const row = {
				id: 1,
				thread_id: 0,
				post_id: 0,
				author_id: 0,
				filename: "",
				file_path: "",
				file_size: 0,
				is_image: 0,
				width: 0,
				has_thumb: 0,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect(Object.keys(attachment)).toHaveLength(12);
		});

		it("should not leak snake_case field names", () => {
			const row = {
				id: 1,
				thread_id: 1,
				post_id: 1,
				author_id: 1,
				filename: "f",
				file_path: "/f",
				file_size: 1,
				is_image: 1,
				width: 1,
				has_thumb: 1,
				downloads: 0,
				created_at: 0,
			};

			const attachment = toAttachment(row);
			expect("thread_id" in attachment).toBe(false);
			expect("post_id" in attachment).toBe(false);
			expect("author_id" in attachment).toBe(false);
			expect("file_path" in attachment).toBe(false);
			expect("file_size" in attachment).toBe(false);
			expect("is_image" in attachment).toBe(false);
			expect("has_thumb" in attachment).toBe(false);
			expect("created_at" in attachment).toBe(false);
		});
	});
});
