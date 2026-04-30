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
import { loadForumList } from "@/viewmodels/forum/forum-list.server";

const mockForumApi = forumApi as any;

describe("loadForumList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("fetches forums and returns visible tree", async () => {
		const forums = [
			{
				id: 1,
				parentId: 0,
				name: "General",
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
				name: "Sub",
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
		mockForumApi.getAll.mockResolvedValue({ data: forums });

		const result = await loadForumList();
		expect(mockForumApi.getAll).toHaveBeenCalledWith("/api/v1/forums");
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeGreaterThan(0);
		expect(result[0].id).toBe(1);
		expect(result[0].children.length).toBe(1);
	});

	it("filters invisible forums", async () => {
		const forums = [
			{
				id: 1,
				parentId: 0,
				name: "Visible",
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
				parentId: 0,
				name: "Hidden",
				status: -1,
				threads: 0,
				posts: 0,
				displayOrder: 2,
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
		mockForumApi.getAll.mockResolvedValue({ data: forums });

		const result = await loadForumList();
		expect(result.length).toBe(1);
		expect(result[0].name).toBe("Visible");
	});

	it("returns empty array for empty forums", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [] });
		const result = await loadForumList();
		expect(result).toEqual([]);
	});
});
