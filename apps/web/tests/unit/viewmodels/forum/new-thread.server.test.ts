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

vi.mock("@/lib/forum-data", async () => {
	const { forumApi } = await import("@/lib/forum-api");
	return {
		getForumList: async () => {
			const res = await (forumApi as any).getAll("/api/v1/forums");
			return res.data;
		},
		getForumAncestors: async (forumId: number) => {
			const res = await (forumApi as any).get(`/api/v1/forums/${forumId}/ancestors`);
			return res.data;
		},
		getThreadById: vi.fn(),
	};
});

import { forumApi } from "@/lib/forum-api";
import { loadNewThreadPageData } from "@/viewmodels/forum/new-thread.server";

const mockForumApi = forumApi as any;

describe("loadNewThreadPageData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns forumId and forumName from ancestors endpoint", async () => {
		mockForumApi.get.mockResolvedValue({
			data: {
				forum: {
					id: 2,
					parentId: 1,
					name: "Sub Forum",
					status: 1,
					visibility: "public",
					type: "forum",
					moderatorIds: "",
					moderatorList: [],
				},
				ancestors: [{ id: 1, parentId: 0, name: "Root Forum" }],
			},
		});

		const result = await loadNewThreadPageData(2);
		expect(result.forumId).toBe(2);
		expect(result.forumName).toBe("Sub Forum");
	});

	it("returns fallback when ancestors endpoint fails (forum not found)", async () => {
		mockForumApi.get.mockRejectedValue(new Error("FORUM_NOT_FOUND"));

		const result = await loadNewThreadPageData(999);
		expect(result.forumName).toBe("版块 999");
	});

	it("returns breadcrumbs with ancestors + forum + 发表主题", async () => {
		mockForumApi.get.mockResolvedValue({
			data: {
				forum: {
					id: 2,
					parentId: 1,
					name: "Sub Forum",
					status: 1,
					visibility: "public",
					type: "forum",
					moderatorIds: "",
					moderatorList: [],
				},
				ancestors: [{ id: 1, parentId: 0, name: "Root Forum" }],
			},
		});

		const result = await loadNewThreadPageData(2);
		expect(result.breadcrumbs).toBeDefined();
		expect(Array.isArray(result.breadcrumbs)).toBe(true);
		// [首页, Root Forum (link), Sub Forum (link), 发表主题]
		expect(result.breadcrumbs[0].label).toBe("同济网论坛");
		expect(result.breadcrumbs[0].href).toBe("/");
		expect(result.breadcrumbs[1].label).toBe("Root Forum");
		expect(result.breadcrumbs[1].href).toBe("/forums/1");
		expect(result.breadcrumbs[2].label).toBe("Sub Forum");
		expect(result.breadcrumbs[2].href).toBe("/forums/2");
		expect(result.breadcrumbs[result.breadcrumbs.length - 1].label).toBe("发表主题");
	});

	it("returns breadcrumbs for root-level forum (no ancestors)", async () => {
		mockForumApi.get.mockResolvedValue({
			data: {
				forum: {
					id: 1,
					parentId: 0,
					name: "Root Forum",
					status: 1,
					visibility: "public",
					type: "group",
					moderatorIds: "",
					moderatorList: [],
				},
				ancestors: [],
			},
		});

		const result = await loadNewThreadPageData(1);
		// [首页, Root Forum (link), 发表主题]
		expect(result.breadcrumbs).toHaveLength(3);
		expect(result.breadcrumbs[0].label).toBe("同济网论坛");
		expect(result.breadcrumbs[1].label).toBe("Root Forum");
		expect(result.breadcrumbs[1].href).toBe("/forums/1");
		expect(result.breadcrumbs[2].label).toBe("发表主题");
	});

	it("calls ancestors endpoint with correct forum ID", async () => {
		mockForumApi.get.mockResolvedValue({
			data: {
				forum: {
					id: 42,
					parentId: 0,
					name: "Forum 42",
					status: 1,
					visibility: "public",
					type: "forum",
					moderatorIds: "",
					moderatorList: [],
				},
				ancestors: [],
			},
		});

		await loadNewThreadPageData(42);
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/forums/42/ancestors");
	});
});
