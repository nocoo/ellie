import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { countForums, fetchForumList, findForumById } from "@/viewmodels/forum/forum-list";

describe("forum-list ViewModel", () => {
	describe("fetchForumList", () => {
		test("returns tree and allForums", async () => {
			const repos = createRepositories();
			const data = await fetchForumList(repos);
			expect(Array.isArray(data.tree)).toBe(true);
			expect(Array.isArray(data.allForums)).toBe(true);
			expect(data.allForums.length).toBeGreaterThan(0);
		});

		test("tree root nodes are groups (parentId=0)", async () => {
			const repos = createRepositories();
			const data = await fetchForumList(repos);
			expect(data.tree.length).toBeGreaterThan(0);
			for (const node of data.tree) {
				expect(node.parentId).toBe(0);
			}
		});

		test("tree is sorted by displayOrder", async () => {
			const repos = createRepositories();
			const data = await fetchForumList(repos);
			if (data.tree.length > 1) {
				for (let i = 1; i < data.tree.length; i++) {
					expect(data.tree[i].displayOrder).toBeGreaterThanOrEqual(data.tree[i - 1].displayOrder);
				}
			}
		});

		test("filters out hidden forums (status=0)", async () => {
			const repos = createRepositories();
			// First hide a forum
			const forums = await repos.forums.listAll();
			const target = forums.find((f) => f.status === 1 && f.type !== "group");
			if (!target) throw new Error("No visible non-group forum in mock data");

			await repos.forums.update(target.id, { status: 0 });

			const data = await fetchForumList(repos);
			// Walk tree to ensure hidden forum is not present
			function findInTree(nodes: typeof data.tree, id: number): boolean {
				for (const node of nodes) {
					if (node.id === id) return true;
					if (findInTree(node.children, id)) return true;
				}
				return false;
			}
			expect(findInTree(data.tree, target.id)).toBe(false);
		});

		test("allForums includes all forums (even hidden)", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const target = forums.find((f) => f.status === 1 && f.type !== "group");
			if (!target) throw new Error("No visible non-group forum in mock data");

			await repos.forums.update(target.id, { status: 0 });

			const data = await fetchForumList(repos);
			// allForums should still include the hidden forum
			expect(data.allForums.find((f) => f.id === target.id)).toBeDefined();
		});
	});

	describe("countForums", () => {
		test("counts non-group nodes", async () => {
			const repos = createRepositories();
			const data = await fetchForumList(repos);
			const count = countForums(data.tree);
			expect(count).toBeGreaterThan(0);
		});

		test("returns 0 for empty tree", () => {
			expect(countForums([])).toBe(0);
		});

		test("does not count group nodes", async () => {
			const repos = createRepositories();
			const data = await fetchForumList(repos);
			// Group nodes are root level with type="group"
			const groupCount = data.tree.filter((n) => n.type === "group").length;
			const totalNodes = countForumsIncludingGroups(data.tree);
			const forumCount = countForums(data.tree);
			expect(forumCount).toBe(totalNodes - groupCount);
		});
	});

	describe("findForumById", () => {
		test("finds existing forum", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			expect(forums.length).toBeGreaterThan(0);
			const found = findForumById(forums, forums[0].id);
			if (!found) throw new Error("Expected to find forum");
			expect(found.id).toBe(forums[0].id);
		});

		test("returns null for non-existent id", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			expect(findForumById(forums, 999999)).toBeNull();
		});

		test("returns null for empty list", () => {
			expect(findForumById([], 1)).toBeNull();
		});
	});
});

// Helper for tests — counts all nodes including groups
function countForumsIncludingGroups(tree: { children: typeof tree }[]): number {
	let count = 0;
	function walk(nodes: typeof tree): void {
		for (const node of nodes) {
			count++;
			walk(node.children);
		}
	}
	walk(tree);
	return count;
}
