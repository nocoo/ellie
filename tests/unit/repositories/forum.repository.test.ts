import { describe, expect, it } from "bun:test";
import { createMockDataStore } from "@ellie/test-mocks";
import { createMockForumRepository } from "@ellie/test-mocks";

describe("createMockForumRepository", () => {
	const store = createMockDataStore();
	const repo = createMockForumRepository(store);

	// ─── listAll ───────────────────────────────────────────

	describe("listAll", () => {
		it("returns all forums", async () => {
			const forums = await repo.listAll();
			expect(forums.length).toBe(store.forums.length);
		});

		it("returns a copy (mutations do not affect store)", async () => {
			const forums = await repo.listAll();
			const originalLength = store.forums.length;
			forums.pop();
			expect(store.forums.length).toBe(originalLength);
		});
	});

	// ─── getById ───────────────────────────────────────────

	describe("getById", () => {
		it("returns forum by id", async () => {
			const forum = await repo.getById(10);
			expect(forum).not.toBeNull();
			expect(forum?.id).toBe(10);
			expect(forum?.name).toBe("校园新闻");
		});

		it("returns null for non-existent id", async () => {
			const forum = await repo.getById(99999);
			expect(forum).toBeNull();
		});

		it("returns the hidden forum by id", async () => {
			const forum = await repo.getById(99);
			expect(forum).not.toBeNull();
			expect(forum?.status).toBe(0);
		});
	});

	// ─── update ────────────────────────────────────────────

	describe("update", () => {
		it("updates name", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			await freshRepo.update(10, { name: "新名称" });
			const forum = await freshRepo.getById(10);
			expect(forum?.name).toBe("新名称");
		});

		it("updates description", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			await freshRepo.update(10, { description: "新描述" });
			const forum = await freshRepo.getById(10);
			expect(forum?.description).toBe("新描述");
		});

		it("updates icon", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			await freshRepo.update(10, { icon: "star" });
			const forum = await freshRepo.getById(10);
			expect(forum?.icon).toBe("star");
		});

		it("updates status", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			await freshRepo.update(10, { status: 0 });
			const forum = await freshRepo.getById(10);
			expect(forum?.status).toBe(0);
		});

		it("updates displayOrder", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			await freshRepo.update(10, { displayOrder: 42 });
			const forum = await freshRepo.getById(10);
			expect(forum?.displayOrder).toBe(42);
		});

		it("updates multiple fields at once", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			await freshRepo.update(10, {
				name: "A",
				description: "B",
				icon: "C",
				status: 0,
				displayOrder: 99,
			});
			const forum = await freshRepo.getById(10);
			expect(forum?.name).toBe("A");
			expect(forum?.description).toBe("B");
			expect(forum?.icon).toBe("C");
			expect(forum?.status).toBe(0);
			expect(forum?.displayOrder).toBe(99);
		});

		it("does not modify fields that are undefined in input", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockForumRepository(freshStore);

			const before = await freshRepo.getById(10);
			await freshRepo.update(10, { name: "Changed" });
			const after = await freshRepo.getById(10);
			expect(after?.name).toBe("Changed");
			expect(after?.description).toBe(before?.description);
			expect(after?.icon).toBe(before?.icon);
		});

		it("throws when forum not found", async () => {
			expect(repo.update(99999, { name: "x" })).rejects.toThrow("Forum 99999 not found");
		});
	});
});
