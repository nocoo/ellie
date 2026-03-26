import { beforeEach, describe, expect, test } from "bun:test";
import { type MockDataStore, createMockDataStore } from "@/data/mock/store";
import { createMockThreadRepository } from "@/data/repositories/thread.repository";
import type { ThreadRepository } from "@/data/repositories/types";
import { StickyLevel } from "@/models/types";

let store: MockDataStore;
let repo: ThreadRepository;

beforeEach(() => {
	store = createMockDataStore();
	repo = createMockThreadRepository(store);
});

describe("MockThreadRepository", () => {
	// ─── list ───────────────────────────────────────────
	describe("list", () => {
		test("returns all threads with default params", async () => {
			const result = await repo.list({});
			expect(result.items.length).toBeGreaterThan(0);
			expect(result.total).toBeGreaterThan(0);
		});

		test("filters by forumId", async () => {
			const result = await repo.list({ forumId: 10 });
			expect(result.items.length).toBeGreaterThan(0);
			for (const t of result.items) {
				expect(t.forumId).toBe(10);
			}
		});

		test("filters by authorId", async () => {
			const result = await repo.list({ authorId: 1 });
			expect(result.items.length).toBeGreaterThan(0);
			for (const t of result.items) {
				expect(t.authorId).toBe(1);
			}
		});

		test("filters digest only", async () => {
			const result = await repo.list({ digest: true });
			expect(result.items.length).toBeGreaterThan(0);
			for (const t of result.items) {
				expect(t.digest).toBeGreaterThan(0);
			}
		});

		test("filters by createdAfter", async () => {
			const cutoff = 1711400000;
			const result = await repo.list({ createdAfter: cutoff });
			expect(result.items.length).toBeGreaterThan(0);
			for (const t of result.items) {
				expect(t.createdAt).toBeGreaterThanOrEqual(cutoff);
			}
		});

		test("sorts by latest (lastPostAt desc) by default", async () => {
			const result = await repo.list({});
			expect(result.items.length).toBeGreaterThan(1);
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].lastPostAt).toBeGreaterThanOrEqual(result.items[i].lastPostAt);
			}
		});

		test("sorts by newest (createdAt desc)", async () => {
			const result = await repo.list({ sort: "newest" });
			expect(result.items.length).toBeGreaterThan(1);
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].createdAt).toBeGreaterThanOrEqual(result.items[i].createdAt);
			}
		});

		test("sorts by hot (replies desc)", async () => {
			const result = await repo.list({ sort: "hot" });
			expect(result.items.length).toBeGreaterThan(1);
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].replies).toBeGreaterThanOrEqual(result.items[i].replies);
			}
		});

		test("respects limit", async () => {
			const result = await repo.list({ limit: 2 });
			expect(result.items.length).toBeLessThanOrEqual(2);
		});

		test("provides nextCursor when more items", async () => {
			const result = await repo.list({ limit: 2 });
			if (result.total > 2) {
				expect(result.nextCursor).not.toBeNull();
			}
		});

		// ─── Cursor pagination ─────────────────────────
		test("cursor forward pagination returns next page without overlap", async () => {
			const page1 = await repo.list({ limit: 3 });
			expect(page1.items.length).toBe(3);
			expect(page1.nextCursor).not.toBeNull();

			const page2 = await repo.list({ limit: 3, cursor: page1.nextCursor! });
			expect(page2.items.length).toBeGreaterThan(0);
			const page1Ids = new Set(page1.items.map((t) => t.id));
			for (const t of page2.items) {
				expect(page1Ids.has(t.id)).toBe(false);
			}
		});

		test("cursor backward pagination returns previous items", async () => {
			const page1 = await repo.list({ limit: 3 });
			const page2 = await repo.list({ limit: 3, cursor: page1.nextCursor! });
			expect(page2.prevCursor).not.toBeNull();

			const backPage = await repo.list({
				limit: 3,
				cursor: page2.prevCursor!,
				direction: "backward",
			});
			expect(backPage.items.length).toBeGreaterThan(0);
		});

		test("first page has no prevCursor", async () => {
			const page1 = await repo.list({ limit: 3 });
			expect(page1.prevCursor).toBeNull();
		});
	});

	// ─── search ─────────────────────────────────────────
	describe("search", () => {
		test("searches by titlePrefix", async () => {
			const result = await repo.search({ titlePrefix: "2024" });
			expect(result.items.length).toBeGreaterThan(0);
			for (const t of result.items) {
				expect(t.subject.startsWith("2024")).toBe(true);
			}
		});

		test("searches by authorName", async () => {
			const result = await repo.search({ authorName: "admin" });
			expect(result.items.length).toBeGreaterThan(0);
			for (const t of result.items) {
				expect(t.authorName).toBe("admin");
			}
		});

		test("throws without titlePrefix or authorName", async () => {
			await expect(repo.search({})).rejects.toThrow("search requires titlePrefix or authorName");
		});

		test("returns empty for no match", async () => {
			const result = await repo.search({ titlePrefix: "ZZZZNONEXISTENT" });
			expect(result.items).toHaveLength(0);
			expect(result.total).toBe(0);
		});
	});

	// ─── getById ────────────────────────────────────────
	describe("getById", () => {
		test("returns thread when exists", async () => {
			const all = await repo.list({});
			const first = all.items[0];
			const found = await repo.getById(first.id);
			expect(found).not.toBeNull();
			expect(found?.id).toBe(first.id);
		});

		test("returns null when not found", async () => {
			expect(await repo.getById(999999)).toBeNull();
		});
	});

	// ─── create ─────────────────────────────────────────
	describe("create", () => {
		test("creates a new thread and returns it", async () => {
			const before = await repo.list({});
			const created = await repo.create({
				forumId: 10,
				authorId: 1,
				authorName: "admin",
				subject: "New Thread",
				content: "<p>Hello</p>",
			});
			expect(created.id).toBeGreaterThan(0);
			expect(created.subject).toBe("New Thread");
			expect(created.forumId).toBe(10);
			expect(created.authorId).toBe(1);
			expect(created.authorName).toBe("admin");

			const after = await repo.list({});
			expect(after.total).toBe(before.total + 1);
		});

		test("creates first post in shared store", async () => {
			const postsBefore = store.posts.length;
			const created = await repo.create({
				forumId: 10,
				authorId: 1,
				authorName: "admin",
				subject: "Thread with post",
				content: "<p>First post content</p>",
			});

			expect(store.posts.length).toBe(postsBefore + 1);
			const firstPost = store.posts.find((p) => p.threadId === created.id);
			expect(firstPost).toBeDefined();
			expect(firstPost?.isFirst).toBe(true);
			expect(firstPost?.content).toBe("<p>First post content</p>");
			expect(firstPost?.authorId).toBe(1);
			expect(firstPost?.authorName).toBe("admin");
			expect(firstPost?.position).toBe(1);
		});
	});

	// ─── delete ─────────────────────────────────────────
	describe("delete", () => {
		test("removes thread", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.delete(target.id);
			expect(await repo.getById(target.id)).toBeNull();
		});

		test("cascade-deletes associated posts", async () => {
			const created = await repo.create({
				forumId: 10,
				authorId: 1,
				authorName: "admin",
				subject: "Cascade test",
				content: "<p>First</p>",
			});
			// Verify the first post exists
			const postsBefore = store.posts.filter((p) => p.threadId === created.id);
			expect(postsBefore.length).toBe(1);

			await repo.delete(created.id);
			// Posts should be gone
			const postsAfter = store.posts.filter((p) => p.threadId === created.id);
			expect(postsAfter.length).toBe(0);
		});

		test("throws for non-existent", async () => {
			await expect(repo.delete(999999)).rejects.toThrow("Thread 999999 not found");
		});
	});

	// ─── moderation operations ──────────────────────────
	describe("setSticky", () => {
		test("updates sticky level", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setSticky(target.id, StickyLevel.Global);
			const updated = await repo.getById(target.id);
			expect(updated?.sticky).toBe(StickyLevel.Global);
		});

		test("throws for non-existent", async () => {
			await expect(repo.setSticky(999999, StickyLevel.Forum)).rejects.toThrow();
		});
	});

	describe("setDigest", () => {
		test("updates digest level", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setDigest(target.id, 2);
			const updated = await repo.getById(target.id);
			expect(updated?.digest).toBe(2);
		});
	});

	describe("setClosed", () => {
		test("closes a thread", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setClosed(target.id, true);
			const updated = await repo.getById(target.id);
			expect(updated?.closed).toBe(1);
		});

		test("reopens a thread", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setClosed(target.id, true);
			await repo.setClosed(target.id, false);
			const updated = await repo.getById(target.id);
			expect(updated?.closed).toBe(0);
		});
	});

	describe("move", () => {
		test("moves thread to another forum", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.move(target.id, 99);
			const updated = await repo.getById(target.id);
			expect(updated?.forumId).toBe(99);
		});

		test("syncs forumId on associated posts", async () => {
			const created = await repo.create({
				forumId: 10,
				authorId: 1,
				authorName: "admin",
				subject: "Move sync test",
				content: "<p>Body</p>",
			});
			const postBefore = store.posts.find((p) => p.threadId === created.id);
			expect(postBefore?.forumId).toBe(10);

			await repo.move(created.id, 77);
			const postAfter = store.posts.find((p) => p.threadId === created.id);
			expect(postAfter?.forumId).toBe(77);
		});

		test("throws for non-existent", async () => {
			await expect(repo.move(999999, 1)).rejects.toThrow();
		});
	});
});
