import { beforeEach, describe, expect, test } from "bun:test";
import { createMockPostRepository } from "@/data/repositories/post.repository";
import type { PostRepository } from "@/data/repositories/types";

let repo: PostRepository;

beforeEach(() => {
	repo = createMockPostRepository();
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
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i].position).toBeGreaterThanOrEqual(result.items[i - 1].position);
			}
		});

		test("throws without threadId or authorId", async () => {
			expect(repo.list({})).rejects.toThrow("list requires threadId or authorId");
		});

		test("returns empty for non-existent thread", async () => {
			const result = await repo.list({ threadId: 999999 });
			expect(result.items).toHaveLength(0);
		});

		test("respects limit", async () => {
			const result = await repo.list({ threadId: 50001, limit: 1 });
			expect(result.items.length).toBeLessThanOrEqual(1);
		});
	});

	describe("create", () => {
		test("creates a new post", async () => {
			const before = await repo.list({ threadId: 50001 });
			const created = await repo.create({ threadId: 50001, content: "<p>New reply</p>" });
			expect(created.id).toBeGreaterThan(0);
			expect(created.threadId).toBe(50001);
			expect(created.content).toBe("<p>New reply</p>");
			expect(created.isFirst).toBe(false);

			const after = await repo.list({ threadId: 50001 });
			expect(after.total).toBe(before.total + 1);
		});

		test("increments position", async () => {
			const before = await repo.list({ threadId: 50001 });
			const maxPos = Math.max(...before.items.map((p) => p.position));
			const created = await repo.create({ threadId: 50001, content: "<p>reply</p>" });
			expect(created.position).toBe(maxPos + 1);
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
			expect(repo.delete(999999)).rejects.toThrow("Post 999999 not found");
		});
	});
});
