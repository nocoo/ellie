import {
	buildForumBreadcrumbs,
	buildForumBreadcrumbsFromAncestors,
	buildNewThreadBreadcrumbsFromAncestors,
	buildThreadBreadcrumbs,
	buildThreadBreadcrumbsFromAncestors,
	buildUserBreadcrumbs,
} from "@/lib/forum-breadcrumbs";
import { findForumAncestors } from "@ellie/types";
import type { Forum } from "@ellie/types";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const FORUMS: Forum[] = [
	{
		id: 1,
		parentId: 0,
		name: "技术分区",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: 0,
		status: 1,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
	},
	{
		id: 10,
		parentId: 1,
		name: "前端开发",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: 0,
		status: 1,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
	},
	{
		id: 100,
		parentId: 10,
		name: "React",
		description: "",
		icon: "",
		displayOrder: 1,
		threads: 0,
		posts: 0,
		type: 0,
		status: 1,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
	},
	{
		id: 2,
		parentId: 0,
		name: "生活分区",
		description: "",
		icon: "",
		displayOrder: 2,
		threads: 0,
		posts: 0,
		type: 0,
		status: 1,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
	},
];

// ---------------------------------------------------------------------------
// findForumAncestors
// ---------------------------------------------------------------------------

describe("findForumAncestors", () => {
	it("returns empty array for non-existent forumId", () => {
		expect(findForumAncestors(FORUMS, 999)).toEqual([]);
	});

	it("returns single item for root forum", () => {
		const result = findForumAncestors(FORUMS, 1);
		expect(result.map((f) => f.id)).toEqual([1]);
	});

	it("returns [root, child] for depth-1 forum", () => {
		const result = findForumAncestors(FORUMS, 10);
		expect(result.map((f) => f.id)).toEqual([1, 10]);
	});

	it("returns [root, child, grandchild] for depth-2 forum", () => {
		const result = findForumAncestors(FORUMS, 100);
		expect(result.map((f) => f.id)).toEqual([1, 10, 100]);
	});

	it("handles self-referencing parentId gracefully", () => {
		const forums: Forum[] = [
			{
				id: 5,
				parentId: 5,
				name: "Self",
				description: "",
				icon: "",
				displayOrder: 1,
				threads: 0,
				posts: 0,
				type: 0,
				status: 1,
				lastThreadId: 0,
				lastPostAt: 0,
				lastPoster: "",
			},
		];
		const result = findForumAncestors(forums, 5);
		expect(result.map((f) => f.id)).toEqual([5]);
	});

	it("returns empty array for empty forums list", () => {
		expect(findForumAncestors([], 1)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// buildForumBreadcrumbs
// ---------------------------------------------------------------------------

describe("buildForumBreadcrumbs", () => {
	it("returns only home item for empty ancestors", () => {
		expect(buildForumBreadcrumbs([])).toEqual([{ label: "同济网论坛", href: "/", icon: "home" }]);
	});

	it("returns [home, forum] for root forum", () => {
		const ancestors = findForumAncestors(FORUMS, 1);
		const items = buildForumBreadcrumbs(ancestors);
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区" },
		]);
	});

	it("returns [home, root→href, child] for depth-1 forum", () => {
		const ancestors = findForumAncestors(FORUMS, 10);
		const items = buildForumBreadcrumbs(ancestors);
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/1" },
			{ label: "前端开发" },
		]);
	});

	it("last item has no href (current page)", () => {
		const ancestors = findForumAncestors(FORUMS, 100);
		const items = buildForumBreadcrumbs(ancestors);
		const last = items[items.length - 1];
		expect(last?.href).toBeUndefined();
		expect(last?.label).toBe("React");
	});

	it("intermediate items have href links", () => {
		const ancestors = findForumAncestors(FORUMS, 100);
		const items = buildForumBreadcrumbs(ancestors);
		// items: [首页, 技术分区→/forums/1, 前端开发→/forums/10, React]
		expect(items[1]).toEqual({ label: "技术分区", href: "/forums/1" });
		expect(items[2]).toEqual({ label: "前端开发", href: "/forums/10" });
	});
});

// ---------------------------------------------------------------------------
// buildThreadBreadcrumbs
// ---------------------------------------------------------------------------

describe("buildThreadBreadcrumbs", () => {
	it("returns [home, subject] when ancestors are empty", () => {
		const items = buildThreadBreadcrumbs([], "Test Thread");
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "Test Thread" },
		]);
	});

	it("all forum ancestors have href, thread subject does not", () => {
		const ancestors = findForumAncestors(FORUMS, 100);
		const items = buildThreadBreadcrumbs(ancestors, "React Hooks 教程");
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/1" },
			{ label: "前端开发", href: "/forums/10" },
			{ label: "React", href: "/forums/100" },
			{ label: "React Hooks 教程" },
		]);
	});

	it("last item is the thread subject without href", () => {
		const ancestors = findForumAncestors(FORUMS, 10);
		const items = buildThreadBreadcrumbs(ancestors, "My Post");
		const last = items[items.length - 1];
		expect(last).toEqual({ label: "My Post" });
	});
});

// ---------------------------------------------------------------------------
// buildUserBreadcrumbs
// ---------------------------------------------------------------------------

describe("buildUserBreadcrumbs", () => {
	it("returns [home, 用户, username]", () => {
		const items = buildUserBreadcrumbs("alice");
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "用户" },
			{ label: "alice" },
		]);
	});

	it("用户 item has no href", () => {
		const items = buildUserBreadcrumbs("bob");
		expect(items[1]?.href).toBeUndefined();
	});

	it("username item has no href", () => {
		const items = buildUserBreadcrumbs("bob");
		expect(items[2]?.href).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// buildForumBreadcrumbsFromAncestors (ancestors endpoint)
// ---------------------------------------------------------------------------

describe("buildForumBreadcrumbsFromAncestors", () => {
	it("returns [home, forumName] when ancestors are empty", () => {
		const items = buildForumBreadcrumbsFromAncestors([], "Current Forum");
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "Current Forum" },
		]);
	});

	it("returns [home, ancestor→href, forumName] for depth-1 forum", () => {
		const items = buildForumBreadcrumbsFromAncestors(
			[{ id: 1, parentId: 0, name: "技术分区" }],
			"前端开发",
		);
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/1" },
			{ label: "前端开发" },
		]);
	});

	it("last item (forumName) has no href", () => {
		const items = buildForumBreadcrumbsFromAncestors(
			[
				{ id: 1, parentId: 0, name: "Root" },
				{ id: 10, parentId: 1, name: "Parent" },
			],
			"Current",
		);
		const last = items[items.length - 1];
		expect(last?.href).toBeUndefined();
		expect(last?.label).toBe("Current");
	});
});

// ---------------------------------------------------------------------------
// buildThreadBreadcrumbsFromAncestors (ancestors endpoint)
// ---------------------------------------------------------------------------

describe("buildThreadBreadcrumbsFromAncestors", () => {
	it("returns [home, forum→href, subject] when no ancestors", () => {
		const items = buildThreadBreadcrumbsFromAncestors([], 5, "技术分区", "React教程");
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/5" },
			{ label: "React教程" },
		]);
	});

	it("all ancestors and forum have href, subject does not", () => {
		const items = buildThreadBreadcrumbsFromAncestors(
			[
				{ id: 1, parentId: 0, name: "技术分区" },
				{ id: 10, parentId: 1, name: "前端开发" },
			],
			100,
			"React",
			"Hooks深入浅出",
		);
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/1" },
			{ label: "前端开发", href: "/forums/10" },
			{ label: "React", href: "/forums/100" },
			{ label: "Hooks深入浅出" },
		]);
	});

	it("thread subject is the last item without href", () => {
		const items = buildThreadBreadcrumbsFromAncestors([], 1, "Root", "Post Title");
		const last = items[items.length - 1];
		expect(last).toEqual({ label: "Post Title" });
	});
});

// ---------------------------------------------------------------------------
// buildNewThreadBreadcrumbsFromAncestors (ancestors endpoint)
// ---------------------------------------------------------------------------

describe("buildNewThreadBreadcrumbsFromAncestors", () => {
	it("returns [home, forum→href, 发表主题] when no ancestors", () => {
		const items = buildNewThreadBreadcrumbsFromAncestors([], 5, "技术分区");
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/5" },
			{ label: "发表主题" },
		]);
	});

	it("all ancestors and forum have href, 发表主题 does not", () => {
		const items = buildNewThreadBreadcrumbsFromAncestors(
			[
				{ id: 1, parentId: 0, name: "技术分区" },
				{ id: 10, parentId: 1, name: "前端开发" },
			],
			100,
			"React",
		);
		expect(items).toEqual([
			{ label: "同济网论坛", href: "/", icon: "home" },
			{ label: "技术分区", href: "/forums/1" },
			{ label: "前端开发", href: "/forums/10" },
			{ label: "React", href: "/forums/100" },
			{ label: "发表主题" },
		]);
	});

	it("发表主题 is always the last item without href", () => {
		const items = buildNewThreadBreadcrumbsFromAncestors(
			[{ id: 1, parentId: 0, name: "Root" }],
			10,
			"Forum",
		);
		const last = items[items.length - 1];
		expect(last).toEqual({ label: "发表主题" });
	});
});
