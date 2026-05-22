import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAll: vi.fn(),
		getCursor: vi.fn(),
		getPage: vi.fn(),
		postAuth: vi.fn(),
	},
	publicUserToUser: vi.fn((u: any) => u),
}));

vi.mock("@/lib/forum-cache", async () => {
	const { forumApi } = await import("@/lib/forum-api");
	return {
		getCachedForumList: async () => {
			const res = await (forumApi as any).getAll("/api/v1/forums");
			return res.data;
		},
		getCachedThreadById: vi.fn(),
		getCachedPageSize: vi.fn(async () => 20),
	};
});

vi.mock("@/lib/forum-breadcrumbs", () => ({
	buildForumBreadcrumbs: vi.fn(() => [{ label: "首页", href: "/" }]),
}));

vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: vi.fn(async () => ({})),
	getStr: vi.fn((_settings: any, _key: string, fallback: string) => fallback),
}));

import { forumApi } from "@/lib/forum-api";
import { loadThreadList, loadThreadListPaged } from "@/viewmodels/forum/thread-list.server";

const mockForumApi = forumApi as {
	getAll: ReturnType<typeof vi.fn>;
	getCursor: ReturnType<typeof vi.fn>;
	getPage: ReturnType<typeof vi.fn>;
};

const mockForums = [
	{
		id: 1,
		parentId: 0,
		name: "General",
		status: 1,
		threads: 50,
		posts: 200,
		displayOrder: 1,
		moderators: "",
		description: "",
		redirect: "",
		icon: "",
		rules: "",
		lastThreadId: 0,
		lastPostAt: 0,
		lastPostBy: "",
		todayPosts: 0,
	},
	{
		id: 2,
		parentId: 1,
		name: "Sub Forum",
		status: 1,
		threads: 10,
		posts: 30,
		displayOrder: 1,
		moderators: "",
		description: "",
		redirect: "",
		icon: "",
		rules: "",
		lastThreadId: 0,
		lastPostAt: 0,
		lastPostBy: "",
		todayPosts: 0,
	},
];

const mockThreads = [
	{
		id: 100,
		forumId: 1,
		subject: "Test Thread",
		authorId: 1,
		authorName: "user1",
		views: 10,
		replies: 2,
		lastPostAt: 1000,
		lastPostBy: "user2",
		createdAt: 900,
		sticky: 0,
		digest: 0,
		highlight: "",
		closed: 0,
		special: 0,
		displayOrder: 0,
	},
];

describe("loadThreadList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.getAll.mockResolvedValue({ data: mockForums });
		mockForumApi.getCursor.mockResolvedValue({ data: mockThreads, meta: { nextCursor: "abc" } });
	});

	it("fetches forums and threads in parallel and returns structured data", async () => {
		const result = await loadThreadList({ forumId: 1 });

		expect(mockForumApi.getAll).toHaveBeenCalledWith("/api/v1/forums");
		expect(mockForumApi.getCursor).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			limit: 20,
			cursor: undefined,
		});
		expect(result.forum).not.toBeNull();
		expect(result.forum?.id).toBe(1);
		expect(result.items.length).toBe(1);
		expect(result.nextCursor).toBe("abc");
		expect(result.prevCursor).toBeNull();
	});

	it("uses custom limit when provided", async () => {
		await loadThreadList({ forumId: 1, limit: 10 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			limit: 10,
			cursor: undefined,
		});
	});

	it("passes cursor parameter", async () => {
		await loadThreadList({ forumId: 1, cursor: "xyz" });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			limit: 20,
			cursor: "xyz",
		});
	});

	it("returns null forum when forumId not found in tree", async () => {
		const result = await loadThreadList({ forumId: 999 });
		expect(result.forum).toBeNull();
	});

	it("finds nested forum in tree", async () => {
		const result = await loadThreadList({ forumId: 2 });
		expect(result.forum?.id).toBe(2);
	});

	it("returns total from forum threads count", async () => {
		const result = await loadThreadList({ forumId: 1 });
		expect(result.total).toBe(50);
	});

	it("falls back to data.length when forum is null", async () => {
		const result = await loadThreadList({ forumId: 999 });
		expect(result.total).toBe(1);
	});
});

describe("loadThreadListPaged", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.getAll.mockResolvedValue({ data: mockForums });
		mockForumApi.getPage.mockResolvedValue({
			data: mockThreads,
			meta: { page: 1, pages: 3, total: 50, limit: 20 },
		});
	});

	it("fetches forums and threads with page-based pagination", async () => {
		const result = await loadThreadListPaged({ forumId: 1 });

		expect(mockForumApi.getPage).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			page: 1,
			limit: 20,
		});
		expect(result.page).toBe(1);
		expect(result.pages).toBe(3);
		expect(result.total).toBe(50);
		expect(result.limit).toBe(20);
		expect(result.forums).toEqual(mockForums);
		expect(result.breadcrumbs).toBeDefined();
	});

	it("uses custom page and limit", async () => {
		await loadThreadListPaged({ forumId: 1, page: 2, limit: 10 });
		expect(mockForumApi.getPage).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			page: 2,
			limit: 10,
		});
	});

	it("defaults to page 1", async () => {
		await loadThreadListPaged({ forumId: 1 });
		expect(mockForumApi.getPage).toHaveBeenCalledWith(
			"/api/v1/threads",
			expect.objectContaining({ page: 1 }),
		);
	});

	it("returns enriched thread items", async () => {
		const result = await loadThreadListPaged({ forumId: 1 });
		expect(result.items[0].thread).toEqual(mockThreads[0]);
		expect(result.items[0].badges).toBeDefined();
	});

	it("handles missing meta fields with defaults", async () => {
		mockForumApi.getPage.mockResolvedValue({ data: mockThreads, meta: {} });
		const result = await loadThreadListPaged({ forumId: 1, page: 2 });
		expect(result.page).toBe(2);
		expect(result.pages).toBe(1);
		expect(result.total).toBe(0);
	});

	// ── 主题分类 typeId plumbing (#9 slice 2) ──────────────────────
	describe("typeId filter", () => {
		it("omits typeId from threads query when null/undefined", async () => {
			await loadThreadListPaged({ forumId: 1, typeId: null });
			expect(mockForumApi.getPage).toHaveBeenCalledWith("/api/v1/threads", {
				forumId: 1,
				page: 1,
				limit: 20,
			});
		});

		it("omits typeId when 0 (no-filter sentinel)", async () => {
			await loadThreadListPaged({ forumId: 1, typeId: 0 });
			expect(mockForumApi.getPage).toHaveBeenCalledWith("/api/v1/threads", {
				forumId: 1,
				page: 1,
				limit: 20,
			});
		});

		it("forwards positive typeId to the Worker", async () => {
			await loadThreadListPaged({ forumId: 1, page: 2, typeId: 11 });
			expect(mockForumApi.getPage).toHaveBeenCalledWith("/api/v1/threads", {
				forumId: 1,
				page: 2,
				limit: 20,
				typeId: 11,
			});
		});
	});

	// ── prefix badge plumbing (#9 slice 4) ─────────────────────────
	describe("includeTypeNameBadge", () => {
		const threadsWithType = [{ ...mockThreads[0], typeName: "求购" }];

		it("default surfaces the typeName badge on enriched items (no config)", async () => {
			mockForumApi.getPage.mockResolvedValue({
				data: threadsWithType,
				meta: { page: 1, pages: 1, total: 1, limit: 20 },
			});
			const result = await loadThreadListPaged({ forumId: 1 });
			expect(result.items[0]?.badges.some((b) => b.type === "typeName")).toBe(true);
		});

		it("includeTypeNameBadge=true surfaces the typeName badge (prefix=true forum)", async () => {
			mockForumApi.getPage.mockResolvedValue({
				data: threadsWithType,
				meta: { page: 1, pages: 1, total: 1, limit: 20 },
			});
			const result = await loadThreadListPaged({
				forumId: 1,
				includeTypeNameBadge: true,
			});
			expect(result.items[0]?.badges.some((b) => b.type === "typeName")).toBe(true);
		});

		it("includeTypeNameBadge=false suppresses the typeName badge (prefix=false forum)", async () => {
			mockForumApi.getPage.mockResolvedValue({
				data: threadsWithType,
				meta: { page: 1, pages: 1, total: 1, limit: 20 },
			});
			const result = await loadThreadListPaged({
				forumId: 1,
				includeTypeNameBadge: false,
			});
			expect(result.items[0]?.badges.some((b) => b.type === "typeName")).toBe(false);
		});

		it("includeTypeNameBadge=true keeps historical disabled typeName visible", async () => {
			mockForumApi.getPage.mockResolvedValue({
				data: [{ ...mockThreads[0], typeName: "已停用分类" }],
				meta: { page: 1, pages: 1, total: 1, limit: 20 },
			});
			const result = await loadThreadListPaged({
				forumId: 1,
				includeTypeNameBadge: true,
			});
			const badge = result.items[0]?.badges.find((b) => b.type === "typeName");
			expect(badge?.label).toBe("已停用分类");
		});
	});
});
