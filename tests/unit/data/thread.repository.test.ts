import { beforeEach, describe, expect, test } from "bun:test";
import { createMockThreadRepository } from "@/data/repositories/thread.repository";
import type { ThreadRepository } from "@/data/repositories/types";
import { StickyLevel } from "@/models/types";

let repo: ThreadRepository;

beforeEach(() => {
	repo = createMockThreadRepository();
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
			for (const t of result.items) {
				expect(t.forumId).toBe(10);
			}
		});

		test("filters by authorId", async () => {
			const result = await repo.list({ authorId: 1 });
			for (const t of result.items) {
				expect(t.authorId).toBe(1);
			}
		});

		test("filters digest only", async () => {
			const result = await repo.list({ digest: true });
			for (const t of result.items) {
				expect(t.digest).toBeGreaterThan(0);
			}
		});

		test("filters by createdAfter", async () => {
			const cutoff = 1711400000;
			const result = await repo.list({ createdAfter: cutoff });
			for (const t of result.items) {
				expect(t.createdAt).toBeGreaterThanOrEqual(cutoff);
			}
		});

		test("sorts by latest (lastPostAt desc) by default", async () => {
			const result = await repo.list({});
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].lastPostAt).toBeGreaterThanOrEqual(result.items[i].lastPostAt);
			}
		});

		test("sorts by newest (createdAt desc)", async () => {
			const result = await repo.list({ sort: "newest" });
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].createdAt).toBeGreaterThanOrEqual(result.items[i].createdAt);
			}
		});

		test("sorts by hot (replies desc)", async () => {
			const result = await repo.list({ sort: "hot" });
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
	});

	// ─── search ─────────────────────────────────────────
	describe("search", () => {
		test("searches by titlePrefix", async () => {
			const result = await repo.search({ titlePrefix: "2024" });
			for (const t of result.items) {
				expect(t.subject.startsWith("2024")).toBe(true);
			}
		});

		test("searches by authorName", async () => {
			const result = await repo.search({ authorName: "admin" });
			for (const t of result.items) {
				expect(t.authorName).toBe("admin");
			}
		});

		test("throws without titlePrefix or authorName", async () => {
			expect(repo.search({})).rejects.toThrow("search requires titlePrefix or authorName");
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
			expect(found!.id).toBe(first.id);
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
				subject: "New Thread",
				content: "<p>Hello</p>",
			});
			expect(created.id).toBeGreaterThan(0);
			expect(created.subject).toBe("New Thread");
			expect(created.forumId).toBe(10);

			const after = await repo.list({});
			expect(after.total).toBe(before.total + 1);
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

		test("throws for non-existent", async () => {
			expect(repo.delete(999999)).rejects.toThrow("Thread 999999 not found");
		});
	});

	// ─── moderation operations ──────────────────────────
	describe("setSticky", () => {
		test("updates sticky level", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setSticky(target.id, StickyLevel.Global);
			const updated = await repo.getById(target.id);
			expect(updated!.sticky).toBe(StickyLevel.Global);
		});

		test("throws for non-existent", async () => {
			expect(repo.setSticky(999999, StickyLevel.Forum)).rejects.toThrow();
		});
	});

	describe("setDigest", () => {
		test("updates digest level", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setDigest(target.id, 2);
			const updated = await repo.getById(target.id);
			expect(updated!.digest).toBe(2);
		});
	});

	describe("setClosed", () => {
		test("closes a thread", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setClosed(target.id, true);
			const updated = await repo.getById(target.id);
			expect(updated!.closed).toBe(1);
		});

		test("reopens a thread", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.setClosed(target.id, true);
			await repo.setClosed(target.id, false);
			const updated = await repo.getById(target.id);
			expect(updated!.closed).toBe(0);
		});
	});

	describe("move", () => {
		test("moves thread to another forum", async () => {
			const all = await repo.list({});
			const target = all.items[0];
			await repo.move(target.id, 99);
			const updated = await repo.getById(target.id);
			expect(updated!.forumId).toBe(99);
		});

		test("throws for non-existent", async () => {
			expect(repo.move(999999, 1)).rejects.toThrow();
		});
	});
});
