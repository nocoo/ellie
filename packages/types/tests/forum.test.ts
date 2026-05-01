import type { Forum, ForumVisibility } from "@ellie/types";
import {
	type ForumTreeNode,
	UserRole,
	type VisibilityContext,
	buildForumTree,
	canViewForumVisibility,
	filterVisibleForums,
	findForumAncestors,
} from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeForum(overrides: Partial<Forum> & { id: number; parentId: number }): Forum {
	return {
		name: `Forum ${overrides.id}`,
		description: "",
		icon: "",
		displayOrder: 0,
		threads: 0,
		posts: 0,
		type: "forum" as const,
		status: 1,
		visibility: "public" as ForumVisibility,
		moderators: "",
		moderatorList: [],
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		...overrides,
	} as Forum;
}

// ---------------------------------------------------------------------------
// buildForumTree
// ---------------------------------------------------------------------------

describe("buildForumTree", () => {
	it("builds a flat list with parentId=0 as root nodes", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, displayOrder: 2 }),
			makeForum({ id: 2, parentId: 0, displayOrder: 1 }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(2);
		expect(tree[0].id).toBe(2); // sorted by displayOrder
		expect(tree[1].id).toBe(1);
	});

	it("nests children under parents", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0 }),
			makeForum({ id: 2, parentId: 1 }),
			makeForum({ id: 3, parentId: 1 }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0].children).toHaveLength(2);
	});

	it("sorts children by displayOrder", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0 }),
			makeForum({ id: 2, parentId: 1, displayOrder: 3 }),
			makeForum({ id: 3, parentId: 1, displayOrder: 1 }),
			makeForum({ id: 4, parentId: 1, displayOrder: 2 }),
		];
		const tree = buildForumTree(forums);
		const children = tree[0].children;
		expect(children.map((c) => c.id)).toEqual([3, 4, 2]);
	});

	it("supports deep nesting (3 levels)", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0 }),
			makeForum({ id: 2, parentId: 1 }),
			makeForum({ id: 3, parentId: 2 }),
		];
		const tree = buildForumTree(forums);
		expect(tree[0].children[0].children[0].id).toBe(3);
	});

	it("skips self-referencing nodes", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0 }),
			makeForum({ id: 2, parentId: 2 }), // self-referencing
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0].children).toHaveLength(0);
	});

	it("returns empty array for empty input", () => {
		expect(buildForumTree([])).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// findForumAncestors
// ---------------------------------------------------------------------------

describe("findForumAncestors", () => {
	const forums = [
		makeForum({ id: 1, parentId: 0 }),
		makeForum({ id: 2, parentId: 1 }),
		makeForum({ id: 3, parentId: 2 }),
	];

	it("returns path from root to target", () => {
		const ancestors = findForumAncestors(forums, 3);
		expect(ancestors.map((f) => f.id)).toEqual([1, 2, 3]);
	});

	it("returns single item for root node", () => {
		const ancestors = findForumAncestors(forums, 1);
		expect(ancestors.map((f) => f.id)).toEqual([1]);
	});

	it("returns empty array for non-existent id", () => {
		expect(findForumAncestors(forums, 999)).toEqual([]);
	});

	it("handles self-referencing parentId gracefully", () => {
		const selfRef = [makeForum({ id: 5, parentId: 5 })];
		const ancestors = findForumAncestors(selfRef, 5);
		expect(ancestors.map((f) => f.id)).toEqual([5]);
	});
});

// ---------------------------------------------------------------------------
// canViewForumVisibility
// ---------------------------------------------------------------------------

describe("canViewForumVisibility", () => {
	const guest: VisibilityContext = { isLoggedIn: false, role: UserRole.User };
	const member: VisibilityContext = { isLoggedIn: true, role: UserRole.User };
	const staff: VisibilityContext = { isLoggedIn: true, role: UserRole.Mod };
	const adminCtx: VisibilityContext = { isLoggedIn: true, role: UserRole.Admin };

	it("public: everyone can view", () => {
		expect(canViewForumVisibility("public", guest)).toBe(true);
		expect(canViewForumVisibility("public", member)).toBe(true);
	});

	it("members: only logged-in users", () => {
		expect(canViewForumVisibility("members", guest)).toBe(false);
		expect(canViewForumVisibility("members", member)).toBe(true);
	});

	it("staff: mods, super mods, and admins", () => {
		expect(canViewForumVisibility("staff", guest)).toBe(false);
		expect(canViewForumVisibility("staff", member)).toBe(false);
		expect(canViewForumVisibility("staff", staff)).toBe(true);
		expect(canViewForumVisibility("staff", adminCtx)).toBe(true);
	});

	it("admin: only admins", () => {
		expect(canViewForumVisibility("admin", guest)).toBe(false);
		expect(canViewForumVisibility("admin", staff)).toBe(false);
		expect(canViewForumVisibility("admin", adminCtx)).toBe(true);
	});

	it("unknown visibility defaults to true", () => {
		expect(canViewForumVisibility("unknown" as ForumVisibility, guest)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// filterVisibleForums
// ---------------------------------------------------------------------------

describe("filterVisibleForums", () => {
	function makeNode(overrides: Partial<ForumTreeNode> & { id: number }): ForumTreeNode {
		return {
			parentId: 0,
			name: `Node ${overrides.id}`,
			description: "",
			icon: "",
			displayOrder: 0,
			threads: 0,
			posts: 0,
			type: "forum" as const,
			status: 1,
			visibility: "public" as ForumVisibility,
			moderators: "",
			moderatorList: [],
			todayThreads: 0,
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastPosterId: 0,
			lastPosterAvatar: "",
			lastPosterAvatarPath: "",
			lastThreadSubject: "",
			children: [],
			...overrides,
		} as ForumTreeNode;
	}

	const guest: VisibilityContext = { isLoggedIn: false, role: UserRole.User };
	const member: VisibilityContext = { isLoggedIn: true, role: UserRole.User };

	it("returns null for hidden status (0)", () => {
		const node = makeNode({ id: 1, status: 0 });
		expect(filterVisibleForums(node, guest)).toBeNull();
	});

	it("returns null for deleted status (-1)", () => {
		const node = makeNode({ id: 1, status: -1 });
		expect(filterVisibleForums(node, guest)).toBeNull();
	});

	it("returns null for paused status (2)", () => {
		const node = makeNode({ id: 1, status: 2 });
		expect(filterVisibleForums(node, guest)).toBeNull();
	});

	it("returns null for QQGroup status (3)", () => {
		const node = makeNode({ id: 1, status: 3 });
		expect(filterVisibleForums(node, guest)).toBeNull();
	});

	it("returns node for normal status (1)", () => {
		const node = makeNode({ id: 1, status: 1 });
		expect(filterVisibleForums(node, guest)).not.toBeNull();
	});

	it("filters by visibility", () => {
		const node = makeNode({ id: 1, visibility: "members" });
		expect(filterVisibleForums(node, guest)).toBeNull();
		expect(filterVisibleForums(node, member)).not.toBeNull();
	});

	it("recursively filters children", () => {
		const node = makeNode({
			id: 1,
			children: [
				makeNode({ id: 2, status: 1 }),
				makeNode({ id: 3, status: 0 }), // hidden
				makeNode({ id: 4, visibility: "members" }), // not visible to guest
			],
		});
		const result = filterVisibleForums(node, guest);
		expect(result).not.toBeNull();
		expect(result?.children).toHaveLength(1);
		expect(result?.children[0].id).toBe(2);
	});

	it("uses default guest context when none provided", () => {
		const node = makeNode({ id: 1, visibility: "members" });
		expect(filterVisibleForums(node)).toBeNull();
	});
});
