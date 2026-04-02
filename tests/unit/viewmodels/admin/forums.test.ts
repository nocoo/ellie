import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	type ForumTreeNode,
	type ReorderItem,
	buildForumTree,
	createForum,
	deleteForum,
	fetchForum,
	fetchForums,
	flattenForumTree,
	mergeForums,
	reorderForums,
	statusLabel,
	typeLabel,
	updateForum,
} from "../../../../apps/web/src/viewmodels/admin/forums";

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof mock>;

function mockJsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	mockFetchFn = mock(() =>
		Promise.resolve(
			mockJsonResponse({
				data: [],
				meta: { timestamp: 1711612800000, requestId: "r1", total: 0, page: 1, limit: 50, pages: 0 },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// statusLabel
// ---------------------------------------------------------------------------

describe("statusLabel", () => {
	it("maps status values (Worker: 0=hidden, 1=active)", () => {
		expect(statusLabel(1)).toBe("正常");
		expect(statusLabel(0)).toBe("隐藏");
		expect(statusLabel(99)).toBe("未知");
	});

	it("maps negative status to unknown", () => {
		expect(statusLabel(-1)).toBe("未知");
	});
});

// ---------------------------------------------------------------------------
// typeLabel
// ---------------------------------------------------------------------------

describe("typeLabel", () => {
	it("maps group to 分区", () => {
		expect(typeLabel("group")).toBe("分区");
	});

	it("maps forum to 版块", () => {
		expect(typeLabel("forum")).toBe("版块");
	});

	it("maps sub to 子版块", () => {
		expect(typeLabel("sub")).toBe("子版块");
	});

	it("maps unknown type to 未知", () => {
		expect(typeLabel("unknown" as never)).toBe("未知");
	});
});

// ---------------------------------------------------------------------------
// buildForumTree
// ---------------------------------------------------------------------------

describe("buildForumTree", () => {
	function makeForum(
		overrides: Partial<{
			id: number;
			parentId: number;
			name: string;
			displayOrder: number;
			status: number;
			type: string;
			threads: number;
			posts: number;
			icon: string;
			description: string;
			moderators: string;
			lastThreadId: number;
			lastPostAt: number;
			lastPoster: string;
			lastThreadSubject: string;
		}> & { id: number },
	) {
		return {
			id: overrides.id,
			parentId: overrides.parentId ?? 0,
			name: overrides.name ?? "Test Forum",
			description: overrides.description ?? "",
			icon: overrides.icon ?? "",
			displayOrder: overrides.displayOrder ?? 0,
			threads: overrides.threads ?? 0,
			posts: overrides.posts ?? 0,
			type: (overrides.type ?? "forum") as "group" | "forum" | "sub",
			status: overrides.status ?? 1,
			moderators: overrides.moderators ?? "",
			lastThreadId: overrides.lastThreadId ?? 0,
			lastPostAt: overrides.lastPostAt ?? 0,
			lastPoster: overrides.lastPoster ?? "",
			lastThreadSubject: overrides.lastThreadSubject ?? "",
		};
	}

	it("returns empty array for empty input", () => {
		expect(buildForumTree([])).toEqual([]);
	});

	it("builds a single root with children", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: "group", name: "Group A" }),
			makeForum({ id: 10, parentId: 1, name: "Forum A1" }),
			makeForum({ id: 11, parentId: 1, name: "Forum A2" }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0]?.name).toBe("Group A");
		expect(tree[0]?.children).toHaveLength(2);
	});

	it("sorts by displayOrder", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: "group" }),
			makeForum({ id: 10, parentId: 1, name: "Second", displayOrder: 2 }),
			makeForum({ id: 11, parentId: 1, name: "First", displayOrder: 1 }),
		];
		const tree = buildForumTree(forums);
		expect(tree[0]?.children[0]?.name).toBe("First");
		expect(tree[0]?.children[1]?.name).toBe("Second");
	});

	it("handles multiple roots", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: "group", name: "Group A", displayOrder: 2 }),
			makeForum({ id: 2, parentId: 0, type: "group", name: "Group B", displayOrder: 1 }),
		];
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(2);
		expect(tree[0]?.name).toBe("Group B");
		expect(tree[1]?.name).toBe("Group A");
	});

	it("handles orphan nodes as roots when parentId not found", () => {
		const forums = [makeForum({ id: 10, parentId: 999, name: "Orphan" })];
		// Parent 999 doesn't exist — orphan node is treated as a root by buildForumTree
		const tree = buildForumTree(forums);
		expect(tree).toHaveLength(1);
		expect(tree[0]?.name).toBe("Orphan");
	});

	it("handles deeply nested tree (3 levels)", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: "group", name: "Group" }),
			makeForum({ id: 10, parentId: 1, name: "Forum" }),
			makeForum({ id: 100, parentId: 10, type: "sub", name: "Sub" }),
		];
		const tree = buildForumTree(forums);
		expect(tree[0]?.children[0]?.children[0]?.name).toBe("Sub");
	});

	it("assigns depth to nodes", () => {
		const forums = [
			makeForum({ id: 1, parentId: 0, type: "group" }),
			makeForum({ id: 10, parentId: 1 }),
			makeForum({ id: 100, parentId: 10, type: "sub" }),
		];
		const tree = buildForumTree(forums);
		expect(tree[0]?.depth).toBe(0);
		expect(tree[0]?.children[0]?.depth).toBe(1);
		expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// flattenForumTree
// ---------------------------------------------------------------------------

describe("flattenForumTree", () => {
	it("returns empty array for empty tree", () => {
		expect(flattenForumTree([])).toEqual([]);
	});

	it("flattens a flat tree", () => {
		const nodes: ForumTreeNode[] = [
			{
				id: 1,
				parentId: 0,
				name: "A",
				description: "",
				icon: "",
				displayOrder: 0,
				threads: 0,
				posts: 0,
				type: "group",
				status: 1,
				moderators: "",
				lastThreadId: 0,
				lastPostAt: 0,
				lastPoster: "",
				lastThreadSubject: "",
				children: [],
				depth: 0,
			},
			{
				id: 2,
				parentId: 0,
				name: "B",
				description: "",
				icon: "",
				displayOrder: 1,
				threads: 0,
				posts: 0,
				type: "group",
				status: 1,
				moderators: "",
				lastThreadId: 0,
				lastPostAt: 0,
				lastPoster: "",
				lastThreadSubject: "",
				children: [],
				depth: 0,
			},
		];
		const flat = flattenForumTree(nodes);
		expect(flat).toHaveLength(2);
		expect(flat.map((n) => n.name)).toEqual(["A", "B"]);
	});

	it("flattens nested tree in depth-first order", () => {
		const child: ForumTreeNode = {
			id: 100,
			parentId: 10,
			name: "Sub",
			description: "",
			icon: "",
			displayOrder: 0,
			threads: 0,
			posts: 0,
			type: "sub",
			status: 1,
			moderators: "",
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastThreadSubject: "",
			children: [],
			depth: 2,
		};
		const parent: ForumTreeNode = {
			id: 10,
			parentId: 1,
			name: "Forum",
			description: "",
			icon: "",
			displayOrder: 0,
			threads: 0,
			posts: 0,
			type: "forum",
			status: 1,
			moderators: "",
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastThreadSubject: "",
			children: [child],
			depth: 1,
		};
		const root: ForumTreeNode = {
			id: 1,
			parentId: 0,
			name: "Group",
			description: "",
			icon: "",
			displayOrder: 0,
			threads: 0,
			posts: 0,
			type: "group",
			status: 1,
			moderators: "",
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastThreadSubject: "",
			children: [parent],
			depth: 0,
		};
		const flat = flattenForumTree([root]);
		expect(flat.map((n) => n.name)).toEqual(["Group", "Forum", "Sub"]);
	});
});

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

describe("fetchForums", () => {
	it("calls GET /api/admin/forums", async () => {
		await fetchForums();
		const [url] = mockFetchFn.mock.calls[0] as [string];
		expect(url).toContain("/api/admin/forums");
	});
});

describe("fetchForum", () => {
	it("calls GET /api/admin/forums/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 5, name: "General" }, meta: {} })),
		);
		const forum = await fetchForum(5);
		expect(forum.id).toBe(5);
	});
});

describe("createForum", () => {
	it("calls POST /api/admin/forums", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({ data: { id: 10, name: "New Forum", displayOrder: 1 }, meta: {} }),
			),
		);
		const forum = await createForum({ name: "New Forum", displayOrder: 1 });
		expect(forum.name).toBe("New Forum");
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ name: "New Forum", displayOrder: 1 }));
	});
});

describe("updateForum", () => {
	it("calls PATCH /api/admin/forums/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 5, name: "Updated" }, meta: {} })),
		);
		await updateForum(5, { name: "Updated" });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/5");
		expect(opts.method).toBe("PATCH");
	});
});

describe("deleteForum", () => {
	it("calls DELETE /api/admin/forums/:id", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { deleted: true }, meta: {} })),
		);
		const result = await deleteForum(5);
		expect(result.deleted).toBe(true);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/5");
		expect(opts.method).toBe("DELETE");
	});
});

describe("mergeForums", () => {
	it("calls POST /api/admin/forums/:id/merge with targetForumId", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { merged: true, movedThreads: 15 }, meta: {} })),
		);
		const result = await mergeForums(3, 7);
		expect(result.merged).toBe(true);
		expect(result.movedThreads).toBe(15);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/3/merge");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ targetForumId: 7 }));
	});
});

describe("reorderForums", () => {
	it("calls POST /api/admin/forums/reorder with orders array", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { reordered: true }, meta: {} })),
		);
		const orders: ReorderItem[] = [
			{ id: 3, displayOrder: 0 },
			{ id: 1, displayOrder: 1 },
			{ id: 2, displayOrder: 2 },
		];
		const result = await reorderForums(orders);
		expect(result.reordered).toBe(true);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/forums/reorder");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ orders }));
	});
});
