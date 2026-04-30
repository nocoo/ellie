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
import { getForumTitle, getThreadTitle, getUserTitle } from "@/viewmodels/forum/title.server";

const mockForumApi = forumApi as any;

describe("getThreadTitle", () => {
	it("returns thread subject", async () => {
		mockForumApi.get.mockResolvedValue({ data: { subject: "Hello World" } });
		const result = await getThreadTitle(1);
		expect(result).toBe("Hello World");
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/threads/1");
	});
});

describe("getUserTitle", () => {
	it("returns username", async () => {
		mockForumApi.get.mockResolvedValue({ data: { username: "testuser" } });
		const result = await getUserTitle(42);
		expect(result).toBe("testuser");
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/users/42");
	});
});

describe("getForumTitle", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns forum name when found", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [{ id: 5, name: "General" }] });
		const result = await getForumTitle(5);
		expect(result).toBe("General");
	});

	it("returns fallback when forum not found", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [{ id: 5, name: "General" }] });
		const result = await getForumTitle(999);
		expect(result).toBe("版块 999");
	});
});
