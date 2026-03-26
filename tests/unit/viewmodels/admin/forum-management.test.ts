import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { createForumActions, fetchForumTree } from "@/viewmodels/admin/forum-management";

describe("forum-management ViewModel", () => {
	describe("fetchForumTree", () => {
		test("returns tree and allForums", async () => {
			const repos = createRepositories();
			const data = await fetchForumTree(repos);
			expect(Array.isArray(data.tree)).toBe(true);
			expect(Array.isArray(data.allForums)).toBe(true);
			expect(data.allForums.length).toBeGreaterThan(0);
		});

		test("tree has root nodes (groups)", async () => {
			const repos = createRepositories();
			const data = await fetchForumTree(repos);
			expect(data.tree.length).toBeGreaterThan(0);
			// Root nodes should have parentId = 0
			for (const node of data.tree) {
				expect(node.parentId).toBe(0);
			}
		});

		test("tree nodes have children array", async () => {
			const repos = createRepositories();
			const data = await fetchForumTree(repos);
			for (const node of data.tree) {
				expect(Array.isArray(node.children)).toBe(true);
			}
		});

		test("tree is sorted by displayOrder", async () => {
			const repos = createRepositories();
			const data = await fetchForumTree(repos);
			if (data.tree.length > 1) {
				for (let i = 1; i < data.tree.length; i++) {
					expect(data.tree[i].displayOrder).toBeGreaterThanOrEqual(data.tree[i - 1].displayOrder);
				}
			}
		});
	});

	describe("createForumActions", () => {
		test("updateForum changes forum name", async () => {
			const repos = createRepositories();
			const actions = createForumActions(repos);
			const forums = await repos.forums.listAll();
			const target = forums[0];

			await actions.updateForum(target.id, { name: "Updated Name" });
			const updated = await repos.forums.getById(target.id);
			expect(updated!.name).toBe("Updated Name");
		});

		test("toggleVisibility flips status 1 → 0", async () => {
			const repos = createRepositories();
			const actions = createForumActions(repos);
			const forums = await repos.forums.listAll();
			const active = forums.find((f) => f.status === 1);
			expect(active).toBeDefined();

			await actions.toggleVisibility(active!.id, 1);
			const updated = await repos.forums.getById(active!.id);
			expect(updated!.status).toBe(0);
		});

		test("toggleVisibility flips status 0 → 1", async () => {
			const repos = createRepositories();
			const actions = createForumActions(repos);
			const forums = await repos.forums.listAll();
			const target = forums[0];

			// First hide it
			await repos.forums.update(target.id, { status: 0 });
			// Then toggle back
			await actions.toggleVisibility(target.id, 0);
			const updated = await repos.forums.getById(target.id);
			expect(updated!.status).toBe(1);
		});

		test("updateOrder changes displayOrder", async () => {
			const repos = createRepositories();
			const actions = createForumActions(repos);
			const forums = await repos.forums.listAll();
			const target = forums[0];

			await actions.updateOrder(target.id, 999);
			const updated = await repos.forums.getById(target.id);
			expect(updated!.displayOrder).toBe(999);
		});

		test("updateForum throws for non-existent forum", async () => {
			const repos = createRepositories();
			const actions = createForumActions(repos);
			await expect(actions.updateForum(999999, { name: "x" })).rejects.toThrow();
		});
	});
});
