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
import { loadSiteStats } from "@/viewmodels/forum/stats.server";

const mockForumApi = forumApi as any;

describe("loadSiteStats", () => {
	const mockStats = {
		todayPosts: 10,
		yesterdayPosts: 20,
		totalThreads: 1000,
		totalPosts: 5000,
		totalMembers: 200,
		newestMember: "newbie",
		totalOnline: 50,
		peakOnline: 100,
		peakDate: "2025-01-01",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.get.mockResolvedValue({ data: mockStats });
	});

	it("fetches and returns site stats", async () => {
		const result = await loadSiteStats();
		expect(result).toEqual(mockStats);
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/stats");
	});
});
