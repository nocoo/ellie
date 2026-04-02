import { describe, expect, it } from "bun:test";
import { encodeCursor } from "@ellie/types";
import { createMockDataStore } from "@ellie/repositories";
import { createMockPostRepository } from "@ellie/repositories";
import { createMockThreadRepository } from "@ellie/repositories";

describe("createMockPostRepository", () => {
	// ─── list ──────────────────────────────────────────────

	describe("list", () => {
		it("throws when no threadId or authorId provided", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			expect(repo.list({})).rejects.toThrow("list requires threadId or authorId");
		});

		it("returns posts filtered by threadId", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001 });
			expect(result.items.every((p) => p.threadId === 50001)).toBe(true);
			expect(result.total).toBe(store.posts.filter((p) => p.threadId === 50001).length);
		});

		it("returns posts filtered by authorId", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ authorId: 10 });
			expect(result.items.every((p) => p.authorId === 10)).toBe(true);
		});

		it("filters by both threadId and authorId", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001, authorId: 10 });
			expect(result.items.every((p) => p.threadId === 50001 && p.authorId === 10)).toBe(true);
		});

		it("sorts by position ascending", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001 });
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].position).toBeLessThanOrEqual(result.items[i].position);
			}
		});

		it("respects limit param", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001, limit: 1 });
			expect(result.items.length).toBe(1);
		});

		it("returns nextCursor when there are more items", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001, limit: 1 });
			if (store.posts.filter((p) => p.threadId === 50001).length > 1) {
				expect(result.nextCursor).not.toBeNull();
			}
		});

		it("returns null prevCursor when no cursor is provided", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001 });
			expect(result.prevCursor).toBeNull();
		});

		it("paginates forward using cursor", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const page1 = await repo.list({ threadId: 50001, limit: 1 });
			if (page1.nextCursor) {
				const page2 = await repo.list({ threadId: 50001, limit: 1, cursor: page1.nextCursor! });
				expect(page2.items.length).toBeGreaterThan(0);
				expect(page2.prevCursor).not.toBeNull();
				// Ensure no overlap
				expect(page1.items[0].id).not.toBe(page2.items[0].id);
			}
		});

		it("paginates backward using cursor", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const page1 = await repo.list({ threadId: 50001, limit: 1 });
			if (page1.nextCursor) {
				const page2 = await repo.list({ threadId: 50001, limit: 1, cursor: page1.nextCursor! });
				const backPage = await repo.list({
					threadId: 50001,
					limit: 1,
					cursor: page2.prevCursor!,
					direction: "backward",
				});
				expect(backPage.items.length).toBeGreaterThan(0);
			}
		});

		it("handles invalid cursor gracefully", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const invalidCursor = btoa("not-valid-json");
			const result = await repo.list({ threadId: 50001, cursor: invalidCursor });
			expect(result.items.length).toBeGreaterThan(0);
		});

		it("returns null nextCursor when all items fit in page", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const result = await repo.list({ threadId: 50001, limit: 100 });
			expect(result.nextCursor).toBeNull();
		});

		it("returns null prevCursor when cursor is used but no items match", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const cursor = encodeCursor({ sortValue: 9999999999, id: 999999 });
			const result = await repo.list({ threadId: 50001, cursor, limit: 10 });
			expect(result.items.length).toBe(0);
			expect(result.prevCursor).toBeNull();
		});
	});

	// ─── create ────────────────────────────────────────────

	describe("create", () => {
		it("creates a new post with correct position", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const threadId = 50001;
			const existingPosts = store.posts.filter((p) => p.threadId === threadId);
			const maxPosition = existingPosts.reduce((max, p) => Math.max(max, p.position), 0);

			const post = await repo.create({
				threadId,
				authorId: 10,
				authorName: "zhangsan",
				content: "新回复",
			});

			expect(post.position).toBe(maxPosition + 1);
			expect(post.threadId).toBe(threadId);
			expect(post.authorId).toBe(10);
			expect(post.authorName).toBe("zhangsan");
			expect(post.content).toBe("新回复");
			expect(post.isFirst).toBe(false);
			expect(post.forumId).toBe(10); // from thread
		});

		it("updates thread replies count", async () => {
			const store = createMockDataStore();
			const postRepo = createMockPostRepository(store);
			const threadRepo = createMockThreadRepository(store);

			const threadBefore = await threadRepo.getById(50001);
			const repliesBefore = threadBefore!.replies;

			await postRepo.create({
				threadId: 50001,
				authorId: 10,
				authorName: "zhangsan",
				content: "新回复",
			});

			const threadAfter = await threadRepo.getById(50001);
			expect(threadAfter!.replies).toBe(repliesBefore + 1);
		});

		it("updates thread lastPoster and lastPostAt", async () => {
			const store = createMockDataStore();
			const postRepo = createMockPostRepository(store);
			const threadRepo = createMockThreadRepository(store);

			await postRepo.create({
				threadId: 50001,
				authorId: 11,
				authorName: "lisi",
				content: "新回复",
			});

			const thread = await threadRepo.getById(50001);
			expect(thread!.lastPoster).toBe("lisi");
		});

		it("resolves forumId to 0 when thread not found", async () => {
			const store = createMockDataStore();
			const postRepo = createMockPostRepository(store);

			const post = await postRepo.create({
				threadId: 99999,
				authorId: 1,
				authorName: "admin",
				content: "orphan post",
			});
			expect(post.forumId).toBe(0);
		});
	});

	// ─── delete ────────────────────────────────────────────

	describe("delete", () => {
		it("deletes a post", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			const countBefore = store.posts.length;

			await repo.delete(100002);

			expect(store.posts.length).toBe(countBefore - 1);
			expect(store.posts.find((p) => p.id === 100002)).toBeUndefined();
		});

		it("decrements thread replies for non-first post", async () => {
			const store = createMockDataStore();
			const postRepo = createMockPostRepository(store);
			const threadRepo = createMockThreadRepository(store);

			const threadBefore = await threadRepo.getById(50001);
			const repliesBefore = threadBefore!.replies;

			await postRepo.delete(100002); // non-first post in thread 50001

			const threadAfter = await threadRepo.getById(50001);
			expect(threadAfter!.replies).toBe(repliesBefore - 1);
		});

		it("does not decrement replies when deleting first post", async () => {
			const store = createMockDataStore();
			const postRepo = createMockPostRepository(store);
			const threadRepo = createMockThreadRepository(store);

			const threadBefore = await threadRepo.getById(50001);
			const repliesBefore = threadBefore!.replies;

			await postRepo.delete(100001); // isFirst=true

			const threadAfter = await threadRepo.getById(50001);
			expect(threadAfter!.replies).toBe(repliesBefore);
		});

		it("recalculates lastPostAt and lastPoster after deleting a post", async () => {
			const store = createMockDataStore();
			const postRepo = createMockPostRepository(store);
			const threadRepo = createMockThreadRepository(store);

			// Delete the latest post (position 3, id 100003)
			await postRepo.delete(100003);

			const thread = await threadRepo.getById(50001);
			// Should now point to the second post (100002) as last
			const remaining = store.posts
				.filter((p) => p.threadId === 50001)
				.sort((a, b) => b.position - a.position);
			expect(thread!.lastPostAt).toBe(remaining[0].createdAt);
			expect(thread!.lastPoster).toBe(remaining[0].authorName);
		});

		it("throws when post not found", async () => {
			const store = createMockDataStore();
			const repo = createMockPostRepository(store);
			expect(repo.delete(99999)).rejects.toThrow("Post 99999 not found");
		});
	});
});
