import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import type { Attachment } from "@/models/types";
import {
	fetchThreadDetail,
	groupAttachmentsByPost,
	resolveAttachmentUrls,
} from "@/viewmodels/forum/thread-detail";

describe("thread-detail ViewModel", () => {
	describe("groupAttachmentsByPost", () => {
		test("groups attachments by postId", () => {
			const attachments: Attachment[] = [
				mockAttachment(1, 10),
				mockAttachment(2, 10),
				mockAttachment(3, 20),
			];
			const map = groupAttachmentsByPost(attachments);
			expect(map.get(10)?.length).toBe(2);
			expect(map.get(20)?.length).toBe(1);
		});

		test("returns empty map for empty array", () => {
			const map = groupAttachmentsByPost([]);
			expect(map.size).toBe(0);
		});

		test("single attachment per post", () => {
			const attachments: Attachment[] = [mockAttachment(1, 10)];
			const map = groupAttachmentsByPost(attachments);
			expect(map.get(10)?.length).toBe(1);
		});
	});

	describe("resolveAttachmentUrls", () => {
		test("generates url from filePath", () => {
			const att = mockAttachment(1, 10);
			const urls = resolveAttachmentUrls(att);
			expect(urls.url).toContain(att.filePath);
		});

		test("generates thumbUrl when hasThumb is true", () => {
			const att = mockAttachment(1, 10, true);
			const urls = resolveAttachmentUrls(att);
			expect(urls.thumbUrl).not.toBeNull();
			expect(urls.thumbUrl).toContain(".thumb.jpg");
		});

		test("returns null thumbUrl when hasThumb is false", () => {
			const att = mockAttachment(1, 10, false);
			const urls = resolveAttachmentUrls(att);
			expect(urls.thumbUrl).toBeNull();
		});
	});

	describe("fetchThreadDetail", () => {
		test("returns null for non-existent thread", async () => {
			const repos = createRepositories();
			const result = await fetchThreadDetail(repos, 999999);
			expect(result).toBeNull();
		});

		test("returns thread data with posts", async () => {
			const repos = createRepositories();
			// Create a thread first to ensure we have one
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			const thread = await repos.threads.create({
				forumId: forum.id,
				authorId: 1,
				authorName: "test",
				subject: "Test Thread",
				content: "<p>Hello</p>",
			});

			const result = await fetchThreadDetail(repos, thread.id);
			if (!result) throw new Error("Expected result");
			expect(result.thread.id).toBe(thread.id);
			expect(result.forum).not.toBeNull();
			expect(result.posts.length).toBeGreaterThan(0);
		});

		test("includes badges for thread", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			const thread = await repos.threads.create({
				forumId: forum.id,
				authorId: 1,
				authorName: "test",
				subject: "Sticky Thread",
				content: "<p>Content</p>",
			});
			// Make it sticky
			await repos.threads.setSticky(thread.id, 2);

			const result = await fetchThreadDetail(repos, thread.id);
			if (!result) throw new Error("Expected result");
			expect(result.badges.length).toBeGreaterThan(0);
		});

		test("posts include author info", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			const users = await repos.users.list({});
			if (users.items.length === 0) throw new Error("No users");
			const user = users.items[0];

			const thread = await repos.threads.create({
				forumId: forum.id,
				authorId: user.id,
				authorName: user.username,
				subject: "Author Thread",
				content: "<p>Content</p>",
			});

			const result = await fetchThreadDetail(repos, thread.id);
			if (!result) throw new Error("Expected result");
			const firstPost = result.posts[0];
			expect(firstPost.author).not.toBeNull();
		});

		test("groups attachments with correct posts", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			const thread = await repos.threads.create({
				forumId: forum.id,
				authorId: 1,
				authorName: "test",
				subject: "Attachment Thread",
				content: "<p>Content</p>",
			});

			const result = await fetchThreadDetail(repos, thread.id);
			if (!result) throw new Error("Expected result");
			// All posts should have attachments array (even if empty)
			for (const postItem of result.posts) {
				expect(Array.isArray(postItem.attachments)).toBe(true);
			}
		});
	});
});

function mockAttachment(id: number, postId: number, hasThumb = false): Attachment {
	return {
		id,
		threadId: 1,
		postId,
		authorId: 1,
		filename: `file-${id}.jpg`,
		filePath: `attachments/file-${id}.jpg`,
		fileSize: 1024 * id,
		isImage: true,
		width: 800,
		hasThumb,
		downloads: 0,
		createdAt: 1000000,
	};
}
