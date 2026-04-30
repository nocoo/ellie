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

import { forumApi } from "@/lib/forum-api";
import { loadNewThreadPageData } from "@/viewmodels/forum/new-thread.server";

const mockForumApi = forumApi as any;

const mockForums = [
	{
		id: 1,
		parentId: 0,
		name: "Root Forum",
		status: 1,
		threads: 10,
		posts: 50,
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
		threads: 5,
		posts: 20,
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

describe("loadNewThreadPageData", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.get.mockResolvedValue({ data: mockForums });
	});

	it("returns forumId and forumName for existing forum", async () => {
		const result = await loadNewThreadPageData(2);
		expect(result.forumId).toBe(2);
		expect(result.forumName).toBe("Sub Forum");
	});

	it("returns fallback name for non-existent forum", async () => {
		const result = await loadNewThreadPageData(999);
		expect(result.forumName).toBe("版块 999");
	});

	it("returns breadcrumbs array", async () => {
		const result = await loadNewThreadPageData(2);
		expect(result.breadcrumbs).toBeDefined();
		expect(Array.isArray(result.breadcrumbs)).toBe(true);
		// Should contain at least "首页" and "发表主题"
		expect(result.breadcrumbs[0].label).toBe("首页");
		expect(result.breadcrumbs[result.breadcrumbs.length - 1].label).toBe("发表主题");
	});
});
