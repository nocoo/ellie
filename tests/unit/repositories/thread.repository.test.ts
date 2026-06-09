import { createMockDataStore, createMockThreadRepository } from "@ellie/test-mocks";
import { StickyLevel } from "@ellie/types";
import { describe, expect, it } from "vitest";

describe("createMockThreadRepository", () => {
	// ─── list ──────────────────────────────────────────────

	describe("list", () => {
		it("returns all threads with default params", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({});
			expect(result.items.length).toBe(store.threads.length);
			expect(result.total).toBe(store.threads.length);
		});

		it("sorts by lastPostAt descending (latest) by default", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({});
			for (let i = 1; i < result.items.length; i++) {
				const a = result.items[i - 1];
				const b = result.items[i];
				if (a.lastPostAt === b.lastPostAt) {
					expect(a.id).toBeGreaterThanOrEqual(b.id);
				} else {
					expect(a.lastPostAt).toBeGreaterThan(b.lastPostAt);
				}
			}
		});

		it("sorts by createdAt when sort=newest", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ sort: "newest" });
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].createdAt).toBeGreaterThanOrEqual(result.items[i].createdAt);
			}
		});

		it("sorts by replies when sort=hot", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ sort: "hot" });
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].replies).toBeGreaterThanOrEqual(result.items[i].replies);
			}
		});

		it("filters by forumId", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ forumId: 10 });
			expect(result.items.every((t) => t.forumId === 10)).toBe(true);
		});

		it("filters by authorId", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ authorId: 1 });
			expect(result.items.every((t) => t.authorId === 1)).toBe(true);
		});

		it("filters by digest=true (digest > 0)", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ digest: true });
			expect(result.items.every((t) => t.digest > 0)).toBe(true);
		});

		it("does not filter by digest when digest is undefined/false", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ digest: false });
			expect(result.items.length).toBe(store.threads.length);
		});

		it("filters by createdAfter", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const threshold = 1711440000;
			const result = await repo.list({ createdAfter: threshold });
			expect(result.items.every((t) => t.createdAt >= threshold)).toBe(true);
		});

		it("respects limit param", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ limit: 2 });
			expect(result.items.length).toBe(2);
		});

		it("returns nextCursor when there are more items", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ limit: 2 });
			expect(result.nextCursor).not.toBeNull();
		});

		it("paginates forward using cursor", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const page1 = await repo.list({ limit: 2 });
			expect(page1.nextCursor).not.toBeNull();
			const cursor1 = page1.nextCursor as string;

			const page2 = await repo.list({ limit: 2, cursor: cursor1 });
			expect(page2.items.length).toBeGreaterThan(0);
			const page1Ids = page1.items.map((t) => t.id);
			const page2Ids = page2.items.map((t) => t.id);
			expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
		});

		it("paginates backward using cursor", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const page1 = await repo.list({ limit: 2, sort: "newest" });
			expect(page1.nextCursor).not.toBeNull();
			const cursor1 = page1.nextCursor as string;

			const page2 = await repo.list({ limit: 2, sort: "newest", cursor: cursor1 });
			expect(page2.prevCursor).not.toBeNull();
			const cursor2 = page2.prevCursor as string;

			const backPage = await repo.list({
				limit: 2,
				sort: "newest",
				cursor: cursor2,
				direction: "backward",
			});
			expect(backPage.items.length).toBeGreaterThan(0);
		});

		it("handles invalid cursor gracefully", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const invalidCursor = btoa("not-valid-json");
			const result = await repo.list({ cursor: invalidCursor });
			expect(result.items.length).toBeGreaterThan(0);
		});

		it("returns null prevCursor when no cursor is provided", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ limit: 2 });
			expect(result.prevCursor).toBeNull();
		});

		it("returns null nextCursor when all items fit in page", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.list({ limit: 100 });
			expect(result.nextCursor).toBeNull();
		});

		it("returns prevCursor when cursor is used and items exist", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const page1 = await repo.list({ limit: 2 });
			expect(page1.nextCursor).not.toBeNull();
			const cursor1 = page1.nextCursor as string;

			const page2 = await repo.list({ limit: 2, cursor: cursor1 });
			expect(page2.prevCursor).not.toBeNull();
		});
	});

	// ─── search ────────────────────────────────────────────

	describe("search", () => {
		it("throws when no titlePrefix or authorName provided", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			expect(repo.search({})).rejects.toThrow("search requires titlePrefix or authorName");
		});

		it("filters by titlePrefix", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.search({ titlePrefix: "2024" });
			expect(result.items.every((t) => t.subject.startsWith("2024"))).toBe(true);
		});

		it("filters by authorName", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.search({ authorName: "admin" });
			expect(result.items.every((t) => t.authorName === "admin")).toBe(true);
		});

		it("combines titlePrefix and authorName", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.search({ titlePrefix: "2024", authorName: "admin" });
			expect(
				result.items.every((t) => t.subject.startsWith("2024") && t.authorName === "admin"),
			).toBe(true);
		});

		it("returns empty when no matches", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.search({ titlePrefix: "ZZZZZ" });
			expect(result.items.length).toBe(0);
		});

		it("sorts by createdAt descending", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const result = await repo.search({ authorName: "admin" });
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].createdAt).toBeGreaterThanOrEqual(result.items[i].createdAt);
			}
		});

		it("supports pagination with cursor", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const page1 = await repo.search({ titlePrefix: "", authorName: "zhangsan", limit: 1 });
			// Using empty titlePrefix is truthy, so it's allowed, but filters to subjects starting with ""
			// which is all of them. authorName will narrow down.
			if (page1.nextCursor) {
				const cursor1 = page1.nextCursor as string;
				const page2 = await repo.search({
					authorName: "zhangsan",
					limit: 1,
					cursor: cursor1,
				});
				expect(page2.items.length).toBeGreaterThan(0);
			}
		});

		it("supports backward pagination in search", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const page1 = await repo.search({ authorName: "zhangsan", limit: 1 });
			if (page1.nextCursor) {
				const cursor1 = page1.nextCursor as string;
				const page2 = await repo.search({
					authorName: "zhangsan",
					limit: 1,
					cursor: cursor1,
				});
				if (page2.prevCursor) {
					const cursor2 = page2.prevCursor as string;
					const backPage = await repo.search({
						authorName: "zhangsan",
						limit: 1,
						cursor: cursor2,
						direction: "backward",
					});
					expect(backPage.items.length).toBeGreaterThan(0);
				}
			}
		});
	});

	// ─── getById ───────────────────────────────────────────

	describe("getById", () => {
		it("returns thread by id", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const thread = await repo.getById(50001);
			expect(thread).not.toBeNull();
			expect(thread?.id).toBe(50001);
			expect(thread?.subject).toBe("2024年同济大学招生简章发布");
		});

		it("returns null for non-existent id", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const thread = await repo.getById(99999);
			expect(thread).toBeNull();
		});
	});

	// ─── create ────────────────────────────────────────────

	describe("create", () => {
		it("creates a new thread and first post", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const originalThreadCount = store.threads.length;
			const originalPostCount = store.posts.length;

			const thread = await repo.create({
				forumId: 10,
				authorId: 10,
				authorName: "zhangsan",
				subject: "测试帖子",
				content: "这是内容",
			});

			expect(thread.id).toBeGreaterThan(0);
			expect(thread.forumId).toBe(10);
			expect(thread.authorId).toBe(10);
			expect(thread.authorName).toBe("zhangsan");
			expect(thread.subject).toBe("测试帖子");
			expect(thread.replies).toBe(0);
			expect(thread.closed).toBe(0);
			expect(thread.sticky).toBe(StickyLevel.None);
			expect(thread.digest).toBe(0);
			expect(store.threads.length).toBe(originalThreadCount + 1);
			expect(store.posts.length).toBe(originalPostCount + 1);

			// Verify the first post was created
			const firstPost = store.posts[store.posts.length - 1];
			expect(firstPost.threadId).toBe(thread.id);
			expect(firstPost.content).toBe("这是内容");
			expect(firstPost.isFirst).toBe(true);
			expect(firstPost.position).toBe(1);
		});
	});

	// ─── delete ────────────────────────────────────────────

	describe("delete", () => {
		it("deletes a thread and its posts", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const threadId = 50001;
			const postsBefore = store.posts.filter((p) => p.threadId === threadId).length;

			await repo.delete(threadId);

			expect(await repo.getById(threadId)).toBeNull();
			const postsAfter = store.posts.filter((p) => p.threadId === threadId).length;
			expect(postsAfter).toBe(0);
			expect(postsAfter).not.toBe(postsBefore);
		});

		it("throws when thread not found", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			expect(repo.delete(99999)).rejects.toThrow("Thread 99999 not found");
		});
	});

	// ─── setSticky ─────────────────────────────────────────

	describe("setSticky", () => {
		it("sets sticky level", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);

			await repo.setSticky(50006, StickyLevel.Global);
			const thread = await repo.getById(50006);
			expect(thread?.sticky).toBe(StickyLevel.Global);
		});

		it("sets sticky to None", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);

			await repo.setSticky(50001, StickyLevel.None);
			const thread = await repo.getById(50001);
			expect(thread?.sticky).toBe(StickyLevel.None);
		});

		it("throws when thread not found", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			expect(repo.setSticky(99999, StickyLevel.Global)).rejects.toThrow("Thread 99999 not found");
		});
	});

	// ─── setDigest ─────────────────────────────────────────

	describe("setDigest", () => {
		it("sets digest level", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);

			await repo.setDigest(50006, 3);
			const thread = await repo.getById(50006);
			expect(thread?.digest).toBe(3);
		});

		it("sets digest to 0", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);

			await repo.setDigest(50002, 0);
			const thread = await repo.getById(50002);
			expect(thread?.digest).toBe(0);
		});

		it("throws when thread not found", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			expect(repo.setDigest(99999, 1)).rejects.toThrow("Thread 99999 not found");
		});
	});

	// ─── setClosed ─────────────────────────────────────────

	describe("setClosed", () => {
		it("closes a thread", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);

			await repo.setClosed(50006, true);
			const thread = await repo.getById(50006);
			expect(thread?.closed).toBe(1);
		});

		it("reopens a closed thread", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);

			await repo.setClosed(50015, false);
			const thread = await repo.getById(50015);
			expect(thread?.closed).toBe(0);
		});

		it("throws when thread not found", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			expect(repo.setClosed(99999, true)).rejects.toThrow("Thread 99999 not found");
		});
	});

	// ─── move ──────────────────────────────────────────────

	describe("move", () => {
		it("moves thread to a new forum and updates posts", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			const threadId = 50001;
			const postsBefore = store.posts.filter((p) => p.threadId === threadId);

			await repo.move(threadId, 20);

			const thread = await repo.getById(threadId);
			expect(thread?.forumId).toBe(20);

			// All posts should have the new forumId
			for (const post of store.posts.filter((p) => p.threadId === threadId)) {
				expect(post.forumId).toBe(20);
			}
			// Same number of posts
			expect(store.posts.filter((p) => p.threadId === threadId).length).toBe(postsBefore.length);
		});

		it("throws when thread not found", async () => {
			const store = createMockDataStore();
			const repo = createMockThreadRepository(store);
			expect(repo.move(99999, 10)).rejects.toThrow("Thread 99999 not found");
		});
	});
});
