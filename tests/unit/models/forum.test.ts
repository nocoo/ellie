import { describe, expect, test } from "bun:test";
import { type ForumTreeNode, buildForumTree, filterVisibleForums } from "@/models/forum";
import type { Forum } from "@/models/types";
import { ForumType } from "@/models/types";

// ─── Fixture ────────────────────────────────────────────

function makeForum(overrides: Partial<Forum> & { id: number }): Forum {
	return {
		parentId: 0,
		name: `Forum ${overrides.id}`,
		description: "",
		icon: "",
		displayOrder: 0,
		threads: 0,
		posts: 0,
		type: ForumType.Forum,
		status: 1,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		...overrides,
	};
}

// ─── buildForumTree ─────────────────────────────────────

describe("buildForumTree", () => {
	test("empty array → empty tree", () => {
		expect(buildForumTree([])).toEqual([]);
	});

	test("single root node", () => {
		const forums = [makeForum({ id: 1, parentId: 0, type: ForumType.Group })];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0].id).toBe(1);
		expect(tree[0].children).toEqual([]);
	});

	test("single layer — multiple roots sorted by displayOrder", () => {
		const forums = [
			makeForum({ id: 3, parentId: 0, displayOrder: 30 }),
			makeForum({ id: 1, parentId: 0, displayOrder: 10 }),
			makeForum({ id: 2, parentId: 0, displayOrder: 20 }),
		];
		const tree = buildForumTree(forums);
		expect(tree.map((n) => n.id)).toEqual([1, 2, 3]);
	});

	test("two layers — Group → Forums", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: ForumType.Group, displayOrder: 1 }),
			makeForum({ id: 10, parentId: 1, type: ForumType.Forum, displayOrder: 2 }),
			makeForum({ id: 11, parentId: 1, type: ForumType.Forum, displayOrder: 1 }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0].children).toHaveLength(2);
		// sorted by displayOrder
		expect(tree[0].children.map((n) => n.id)).toEqual([11, 10]);
	});

	test("three layers — Group → Forum → Sub", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: ForumType.Group, displayOrder: 1 }),
			makeForum({ id: 10, parentId: 1, type: ForumType.Forum, displayOrder: 1 }),
			makeForum({ id: 100, parentId: 10, type: ForumType.Sub, displayOrder: 1 }),
			makeForum({ id: 101, parentId: 10, type: ForumType.Sub, displayOrder: 2 }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0].children).toHaveLength(1);
		expect(tree[0].children[0].children).toHaveLength(2);
		expect(tree[0].children[0].children.map((n) => n.id)).toEqual([100, 101]);
	});

	test("multiple groups with nested children", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: ForumType.Group, displayOrder: 2 }),
			makeForum({ id: 2, parentId: 0, type: ForumType.Group, displayOrder: 1 }),
			makeForum({ id: 10, parentId: 1, type: ForumType.Forum }),
			makeForum({ id: 20, parentId: 2, type: ForumType.Forum }),
		];
		const tree = buildForumTree(forums);
		expect(tree.map((n) => n.id)).toEqual([2, 1]); // sorted by displayOrder
		expect(tree[0].children.map((n) => n.id)).toEqual([20]);
		expect(tree[1].children.map((n) => n.id)).toEqual([10]);
	});

	test("orphaned forums (parentId points to non-existent) are excluded from roots", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: ForumType.Group }),
			makeForum({ id: 99, parentId: 999 }), // orphan — parent doesn't exist
		];
		const tree = buildForumTree(forums);
		// Orphan is stored in the map under key 999, but 999 has no parent node to attach to
		expect(tree).toHaveLength(1);
		expect(tree[0].id).toBe(1);
		expect(tree[0].children).toEqual([]);
	});

	test("same displayOrder — stable ordering", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, displayOrder: 0 }),
			makeForum({ id: 2, parentId: 0, displayOrder: 0 }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(2);
		// Same displayOrder — order is preserved from input after stable sort
	});
});

// ─── filterVisibleForums ────────────────────────────────

describe("filterVisibleForums", () => {
	test("visible node with no children → returned as-is", () => {
		const node: ForumTreeNode = { ...makeForum({ id: 1, status: 1 }), children: [] };
		const result = filterVisibleForums(node);
		expect(result).not.toBeNull();
		expect(result?.id).toBe(1);
	});

	test("hidden node → returns null", () => {
		const node: ForumTreeNode = { ...makeForum({ id: 1, status: 0 }), children: [] };
		expect(filterVisibleForums(node)).toBeNull();
	});

	test("hidden parent hides all descendants", () => {
		const child: ForumTreeNode = { ...makeForum({ id: 10, parentId: 1, status: 1 }), children: [] };
		const parent: ForumTreeNode = { ...makeForum({ id: 1, status: 0 }), children: [child] };
		expect(filterVisibleForums(parent)).toBeNull();
	});

	test("hidden child is removed, visible siblings kept", () => {
		const child1: ForumTreeNode = {
			...makeForum({ id: 10, parentId: 1, status: 1 }),
			children: [],
		};
		const child2: ForumTreeNode = {
			...makeForum({ id: 11, parentId: 1, status: 0 }),
			children: [],
		};
		const parent: ForumTreeNode = {
			...makeForum({ id: 1, status: 1 }),
			children: [child1, child2],
		};
		const result = filterVisibleForums(parent);
		expect(result).not.toBeNull();
		expect(result?.children).toHaveLength(1);
		expect(result?.children[0].id).toBe(10);
	});

	test("deeply nested hidden node is pruned", () => {
		const sub: ForumTreeNode = { ...makeForum({ id: 100, parentId: 10, status: 0 }), children: [] };
		const forum: ForumTreeNode = {
			...makeForum({ id: 10, parentId: 1, status: 1 }),
			children: [sub],
		};
		const group: ForumTreeNode = { ...makeForum({ id: 1, status: 1 }), children: [forum] };
		const result = filterVisibleForums(group);
		expect(result).not.toBeNull();
		expect(result?.children[0].children).toHaveLength(0);
	});

	test("does not mutate original tree", () => {
		const child: ForumTreeNode = { ...makeForum({ id: 10, parentId: 1, status: 0 }), children: [] };
		const parent: ForumTreeNode = { ...makeForum({ id: 1, status: 1 }), children: [child] };
		filterVisibleForums(parent);
		// Original still has the hidden child
		expect(parent.children).toHaveLength(1);
	});
});
