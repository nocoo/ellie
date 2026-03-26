import { beforeEach, describe, expect, test } from "bun:test";
import { type MockDataStore, createMockDataStore } from "@/data/mock/store";
import { createMockForumRepository } from "@/data/repositories/forum.repository";
import type { ForumRepository } from "@/data/repositories/types";

let store: MockDataStore;
let repo: ForumRepository;

beforeEach(() => {
	store = createMockDataStore();
	repo = createMockForumRepository(store);
});

describe("MockForumRepository", () => {
	// ─── listAll ────────────────────────────────────────
	describe("listAll", () => {
		test("returns all forums", async () => {
			const forums = await repo.listAll();
			expect(forums.length).toBeGreaterThan(0);
		});

		test("returns copies (not references to internal data)", async () => {
			const a = await repo.listAll();
			const b = await repo.listAll();
			expect(a).not.toBe(b);
		});
	});

	// ─── getById ────────────────────────────────────────
	describe("getById", () => {
		test("returns forum when exists", async () => {
			const forums = await repo.listAll();
			const first = forums[0];
			const found = await repo.getById(first.id);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(first.id);
		});

		test("returns null when not found", async () => {
			const found = await repo.getById(999999);
			expect(found).toBeNull();
		});
	});

	// ─── update ─────────────────────────────────────────
	describe("update", () => {
		test("updates name", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			await repo.update(target.id, { name: "New Name" });
			const updated = await repo.getById(target.id);
			expect(updated!.name).toBe("New Name");
		});

		test("updates description", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			await repo.update(target.id, { description: "New desc" });
			const updated = await repo.getById(target.id);
			expect(updated!.description).toBe("New desc");
		});

		test("updates status", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			await repo.update(target.id, { status: 0 });
			const updated = await repo.getById(target.id);
			expect(updated!.status).toBe(0);
		});

		test("updates displayOrder", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			await repo.update(target.id, { displayOrder: 99 });
			const updated = await repo.getById(target.id);
			expect(updated!.displayOrder).toBe(99);
		});

		test("updates icon", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			await repo.update(target.id, { icon: "new-icon" });
			const updated = await repo.getById(target.id);
			expect(updated!.icon).toBe("new-icon");
		});

		test("partial update — only touches specified fields", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			const originalName = target.name;
			await repo.update(target.id, { description: "Changed" });
			const updated = await repo.getById(target.id);
			expect(updated!.name).toBe(originalName);
			expect(updated!.description).toBe("Changed");
		});

		test("throws for non-existent forum", async () => {
			await expect(repo.update(999999, { name: "x" })).rejects.toThrow("Forum 999999 not found");
		});

		test("mutation visible via listAll (shared state)", async () => {
			const forums = await repo.listAll();
			const target = forums[0];
			await repo.update(target.id, { name: "Mutated" });
			const all = await repo.listAll();
			const found = all.find((f) => f.id === target.id);
			expect(found!.name).toBe("Mutated");
		});
	});
});
