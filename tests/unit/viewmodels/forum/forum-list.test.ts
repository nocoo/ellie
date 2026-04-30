import { describe, expect, it } from "vitest";
import {
	GRID_THRESHOLD,
	buildVisibleTree,
	formatCount,
	parseModerators,
	totalStats,
} from "../../../../apps/web/src/viewmodels/forum/forum-list";
import type { Forum } from "../../../../packages/types/src/types";
import { ForumType } from "../../../../packages/types/src/types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeForum(overrides: Partial<Forum> & { id: number }): Forum {
	return {
		parentId: 0,
		name: "Test Forum",
		description: "",
		icon: "",
		displayOrder: 0,
		threads: 0,
		posts: 0,
		type: ForumType.Forum,
		status: 1,
		moderators: "",
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastThreadSubject: "",
		...overrides,
	};
}

function makeGroup(id: number, overrides: Partial<Forum> = {}): Forum {
	return makeForum({ id, type: ForumType.Group, ...overrides });
}

function makeForumItem(id: number, parentId: number, overrides: Partial<Forum> = {}): Forum {
	return makeForum({ id, parentId, type: ForumType.Forum, ...overrides });
}

// ---------------------------------------------------------------------------
// buildVisibleTree
// ---------------------------------------------------------------------------

describe("buildVisibleTree", () => {
	it("returns empty array for empty input", () => {
		expect(buildVisibleTree([])).toEqual([]);
	});

	it("builds a single group with forums", () => {
		const forums = [
			makeGroup(1, { name: "Group A" }),
			makeForumItem(10, 1, { name: "Forum A1" }),
			makeForumItem(11, 1, { name: "Forum A2" }),
		];

		const tree = buildVisibleTree(forums);
		expect(tree.length).toBe(1);
		expect(tree[0]?.name).toBe("Group A");
		expect(tree[0]?.children.length).toBe(2);
	});

	it("sorts children by displayOrder", () => {
		const forums = [
			makeGroup(1),
			makeForumItem(10, 1, { name: "Second", displayOrder: 2 }),
			makeForumItem(11, 1, { name: "First", displayOrder: 1 }),
		];

		const tree = buildVisibleTree(forums);
		expect(tree[0]?.children[0]?.name).toBe("First");
		expect(tree[0]?.children[1]?.name).toBe("Second");
	});

	it("filters out hidden forums (status=0)", () => {
		const forums = [
			makeGroup(1),
			makeForumItem(10, 1, { name: "Visible", status: 1 }),
			makeForumItem(11, 1, { name: "Hidden", status: 0 }),
		];

		const tree = buildVisibleTree(forums);
		expect(tree[0]?.children.length).toBe(1);
		expect(tree[0]?.children[0]?.name).toBe("Visible");
	});

	it("filters out hidden groups entirely", () => {
		const forums = [
			makeGroup(1, { name: "Visible Group" }),
			makeGroup(2, { name: "Hidden Group", status: 0 }),
			makeForumItem(10, 1, { name: "Forum A" }),
			makeForumItem(20, 2, { name: "Forum B" }),
		];

		const tree = buildVisibleTree(forums);
		expect(tree.length).toBe(1);
		expect(tree[0]?.name).toBe("Visible Group");
	});

	it("filters out children of hidden forums", () => {
		const forums = [
			makeGroup(1),
			makeForumItem(10, 1, { name: "Parent", status: 0 }),
			makeForum({ id: 100, parentId: 10, name: "Child", type: ForumType.Sub }),
		];

		const tree = buildVisibleTree(forums);
		expect(tree[0]?.children.length).toBe(0);
	});

	it("handles nested sub-forums", () => {
		const forums = [
			makeGroup(1),
			makeForumItem(10, 1, { name: "Parent" }),
			makeForum({ id: 100, parentId: 10, name: "Sub", type: ForumType.Sub }),
		];

		const tree = buildVisibleTree(forums);
		const parent = tree[0]?.children[0];
		expect(parent?.name).toBe("Parent");
		expect(parent?.children.length).toBe(1);
		expect(parent?.children[0]?.name).toBe("Sub");
	});

	it("handles multiple groups", () => {
		const forums = [
			makeGroup(1, { name: "Group A", displayOrder: 2 }),
			makeGroup(2, { name: "Group B", displayOrder: 1 }),
			makeForumItem(10, 1),
			makeForumItem(20, 2),
		];

		const tree = buildVisibleTree(forums);
		expect(tree.length).toBe(2);
		expect(tree[0]?.name).toBe("Group B");
		expect(tree[1]?.name).toBe("Group A");
	});

	it("skips self-referencing nodes (id === parentId) to prevent infinite recursion", () => {
		const forums = [
			makeGroup(1, { name: "Group A" }),
			makeForumItem(10, 1, { name: "Forum A" }),
			makeForum({ id: 0, parentId: 0, name: "Self-ref", status: -1 }),
		];

		const tree = buildVisibleTree(forums);
		// Self-referencing node is skipped entirely
		expect(tree.length).toBe(1);
		expect(tree[0]?.name).toBe("Group A");
	});
});

// ---------------------------------------------------------------------------
// formatCount
// ---------------------------------------------------------------------------

describe("formatCount", () => {
	it("formats small numbers", () => {
		expect(formatCount(0)).toBe("0");
		expect(formatCount(42)).toBe("42");
	});

	it("formats large numbers with commas", () => {
		expect(formatCount(1200)).toBe("1,200");
		expect(formatCount(8500)).toBe("8,500");
		expect(formatCount(1234567)).toBe("1,234,567");
	});
});

// ---------------------------------------------------------------------------
// totalStats
// ---------------------------------------------------------------------------

describe("totalStats", () => {
	it("returns self stats for leaf node", () => {
		const node = { ...makeForumItem(10, 0, { threads: 5, posts: 20 }), children: [] };
		expect(totalStats(node)).toEqual({ threads: 5, posts: 20 });
	});

	it("sums self + children stats", () => {
		const node = {
			...makeForumItem(10, 0, { threads: 10, posts: 50 }),
			children: [
				{
					...makeForum({ id: 100, parentId: 10, threads: 5, posts: 20, type: ForumType.Sub }),
					children: [],
				},
				{
					...makeForum({ id: 101, parentId: 10, threads: 3, posts: 15, type: ForumType.Sub }),
					children: [],
				},
			],
		};
		expect(totalStats(node)).toEqual({ threads: 18, posts: 85 });
	});

	it("handles deeply nested tree", () => {
		const leaf = {
			...makeForum({ id: 200, parentId: 100, threads: 2, posts: 10, type: ForumType.Sub }),
			children: [],
		};
		const mid = {
			...makeForumItem(100, 10, { threads: 3, posts: 15 }),
			children: [leaf],
		};
		const root = {
			...makeForumItem(10, 0, { threads: 5, posts: 25 }),
			children: [mid],
		};
		expect(totalStats(root)).toEqual({ threads: 10, posts: 50 });
	});

	it("handles node with zero stats", () => {
		const node = {
			...makeForumItem(10, 0, { threads: 0, posts: 0 }),
			children: [],
		};
		expect(totalStats(node)).toEqual({ threads: 0, posts: 0 });
	});
});

// ---------------------------------------------------------------------------
// parseModerators
// ---------------------------------------------------------------------------

describe("parseModerators", () => {
	it("returns empty array for empty string", () => {
		expect(parseModerators("")).toEqual([]);
	});

	it("parses single moderator", () => {
		expect(parseModerators("alice")).toEqual(["alice"]);
	});

	it("parses comma-separated moderators", () => {
		expect(parseModerators("alice,bob,charlie")).toEqual(["alice", "bob", "charlie"]);
	});

	it("trims whitespace around moderator names", () => {
		expect(parseModerators(" alice , bob , charlie ")).toEqual(["alice", "bob", "charlie"]);
	});

	it("filters out empty strings from trailing commas", () => {
		expect(parseModerators("alice,,bob,")).toEqual(["alice", "bob"]);
	});
});

// ---------------------------------------------------------------------------
// GRID_THRESHOLD
// ---------------------------------------------------------------------------

describe("GRID_THRESHOLD", () => {
	it("is a number constant", () => {
		expect(typeof GRID_THRESHOLD).toBe("number");
		expect(GRID_THRESHOLD).toBe(10);
	});
});
