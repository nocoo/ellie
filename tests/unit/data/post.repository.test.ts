import { beforeEach, describe, expect, test } from "bun:test";
import { type MockDataStore, createMockDataStore } from "@/data/mock/store";
import { createMockPostRepository } from "@/data/repositories/post.repository";
import type { PostRepository } from "@/data/repositories/types";

let store: MockDataStore;
let repo: PostRepository;

beforeEach(() => {
	store = createMockDataStore();
	repo = createMockPostRepository(store);
});

describe("MockPostRepository", () => {
	describe("list", () => {
		test("lists posts by threadId", async () => {
			const result = await repo.list({ threadId: 50001 });
			expect(result.items.length).toBeGreaterThan(0);
			for (const p of result.items) {
				expect(p.threadId).toBe(50001);
			}
		});

		test("lists posts by authorId", async () => {
			const result = await repo.list({ authorId: 1 });
			expect(result.items.length).toBeGreaterThan(0);
			for (const p of result.items) {
				expect(p.authorId).toBe(1);
			}
		});

		test("sorts by position (ascending)", async () => {
			const result = await repo.list({ threadId: 50001 });
			expect(result.items.length).toBeGreaterThan(1);
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i].position).toBeGreaterThanOrEqual(result.items[i - 1].position);
			}
		});

		test("throws without threadId or authorId", async () => {
			await expect(repo.list({})).rejects.toThrow("list requires threadId or authorId");
		});

		test("returns empty for non-existent thread", async () => {
			const result = await repo.list({ threadId: 999999 });
			expect(result.items).toHaveLength(0);
		});

		test("respects limit", async () => {
			const result = await repo.list({ threadId: 50001, limit: 1 });
			expect(result.items.length).toBeLessThanOrEqual(1);
		});

		// ─── Cursor pagination ─────────────────────────
		test("cursor forward pagination returns next page", async () => {
			const page1 = await repo.list({ threadId: 50001, limit: 1 });
			if (page1.nextCursor) {
				const page2 = await repo.list({ threadId: 50001, limit: 1, cursor: page1.nextCursor });
				expect(page2.items.length).toBeGreaterThan(0);
				expect(page2.items[0].id).not.toBe(page1.items[0].id);
			}
		});

		test("cursor backward pagination returns previous items", async () => {
			const page1 = await repo.list({ threadId: 50001, limit: 1 });
			if (page1.nextCursor) {
				const page2 = await repo.list({ threadId: 50001, limit: 1, cursor: page1.nextCursor });
				if (page2.prevCursor) {
					const backPage = await repo.list({
						threadId: 50001,
						limit: 1,
						cursor: page2.prevCursor,
						direction: "backward",
					});
					expect(backPage.items.length).toBeGreaterThan(0);
				}
			}
		});
	});

	describe("create", () => {
		test("creates a new post with author info", async () => {
			const before = await repo.list({ threadId: 50001 });
			const created = await repo.create({
				threadId: 50001,
				authorId: 1,
				authorName: "admin",
				content: "<p>New reply</p>",
			});
			expect(created.id).toBeGreaterThan(0);
			expect(created.threadId).toBe(50001);
			expect(created.authorId).toBe(1);
			expect(created.authorName).toBe("admin");
			expect(created.content).toBe("<p>New reply</p>");
			expect(created.isFirst).toBe(false);

			const after = await repo.list({ threadId: 50001 });
			expect(after.total).toBe(before.total + 1);
		});

		test("increments position", async () => {
			const before = await repo.list({ threadId: 50001 });
			const maxPos = Math.max(...before.items.map((p) => p.position));
			const created = await repo.create({
				threadId: 50001,
				authorId: 1,
				authorName: "admin",
				content: "<p>reply</p>",
			});
			expect(created.position).toBe(maxPos + 1);
		});

		test("resolves forumId from thread", async () => {
			const thread = store.threads[0];
			const created = await repo.create({
				threadId: thread.id,
				authorId: 1,
				authorName: "admin",
				content: "<p>test</p>",
			});
			expect(created.forumId).toBe(thread.forumId);
		});

		test("updates thread reply count and lastPoster", async () => {
			const thread = store.threads.find((t) => t.id === 50001)!;
			const repliesBefore = thread.replies;
			await repo.create({
				threadId: 50001,
				authorId: 10,
				authorName: "zhangsan",
				content: "<p>reply</p>",
			});
			expect(thread.replies).toBe(repliesBefore + 1);
			expect(thread.lastPoster).toBe("zhangsan");
		});
	});

	describe("delete", () => {
		test("removes post", async () => {
			const all = await repo.list({ threadId: 50001 });
			const target = all.items[0];
			const before = all.total;
			await repo.delete(target.id);
			const after = await repo.list({ threadId: 50001 });
			expect(after.total).toBe(before - 1);
		});

		test("throws for non-existent", async () => {
			await expect(repo.delete(999999)).rejects.toThrow("Post 999999 not found");
		});
	});
});
