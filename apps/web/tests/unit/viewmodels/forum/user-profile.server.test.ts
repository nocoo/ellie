import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAll: vi.fn(),
		getCursor: vi.fn(),
		getPage: vi.fn(),
		postAuth: vi.fn(),
	},
	publicUserToUser: vi.fn((u: any) => ({
		...u,
		id: u.userId ?? u.id,
		threads: u.threads ?? 0,
		posts: u.posts ?? 0,
		digestPosts: u.digestPosts ?? 0,
	})),
}));

vi.mock("@/lib/forum-cache", () => ({
	getCachedPageSize: vi.fn(async () => 20),
}));

import { forumApi } from "@/lib/forum-api";
import { loadUserProfile } from "@/viewmodels/forum/user-profile.server";

const mockForumApi = forumApi as any;

const mockUser = {
	id: 42,
	userId: 42,
	username: "testuser",
	role: 0,
	threads: 5,
	posts: 20,
	digestPosts: 2,
};

describe("loadUserProfile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.get.mockResolvedValue({ data: mockUser });
		mockForumApi.getCursor.mockResolvedValue({ data: [], meta: { nextCursor: null } });
	});

	it("fetches user and returns profile with default tab (threads)", async () => {
		mockForumApi.getCursor.mockResolvedValue({ data: [{ id: 1 }], meta: { nextCursor: "c1" } });
		const result = await loadUserProfile({ userId: 42 });
		expect(result.user.id).toBe(42);
		expect(result.tab).toBe("threads");
		expect(result.threads.items.length).toBe(1);
		expect(result.threads.nextCursor).toBe("c1");
	});

	it("fetches posts tab", async () => {
		mockForumApi.getCursor.mockResolvedValue({ data: [{ id: 10 }], meta: { nextCursor: null } });
		const result = await loadUserProfile({ userId: 42, tab: "posts" });
		expect(result.tab).toBe("posts");
		expect(result.posts.items.length).toBe(1);
		expect(result.threads.items.length).toBe(0);
	});

	it("fetches digest tab", async () => {
		mockForumApi.getCursor.mockResolvedValue({ data: [{ id: 20 }], meta: { nextCursor: null } });
		const result = await loadUserProfile({ userId: 42, tab: "digest" });
		expect(result.tab).toBe("digest");
		expect(result.digest.items.length).toBe(1);
	});

	it("handles digest API failure gracefully", async () => {
		mockForumApi.getCursor.mockRejectedValue(new Error("not found"));
		const result = await loadUserProfile({ userId: 42, tab: "digest" });
		expect(result.digest.items).toEqual([]);
		expect(result.digest.total).toBe(0);
	});

	it("propagates threads API failure (no silent swallow)", async () => {
		mockForumApi.getCursor.mockRejectedValue(new Error("server error"));
		await expect(loadUserProfile({ userId: 42, tab: "threads" })).rejects.toThrow("server error");
	});

	it("propagates posts API failure (no silent swallow)", async () => {
		mockForumApi.getCursor.mockRejectedValue(new Error("server error"));
		await expect(loadUserProfile({ userId: 42, tab: "posts" })).rejects.toThrow("server error");
	});

	it("passes cursor and limit to API", async () => {
		await loadUserProfile({ userId: 42, tab: "threads", cursor: "abc", limit: 5 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith("/api/v1/users/42/threads", {
			limit: 5,
			cursor: "abc",
		});
	});

	it("uses default limit from settings", async () => {
		await loadUserProfile({ userId: 42 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith("/api/v1/users/42/threads", {
			limit: 20,
			cursor: undefined,
		});
	});

	it("sets total from user field for threads tab", async () => {
		mockForumApi.getCursor.mockResolvedValue({ data: [], meta: { nextCursor: null } });
		const result = await loadUserProfile({ userId: 42, tab: "threads" });
		expect(result.threads.total).toBe(5);
	});

	it("sets prevCursor from cursor param", async () => {
		mockForumApi.getCursor.mockResolvedValue({ data: [], meta: { nextCursor: null } });
		const result = await loadUserProfile({ userId: 42, tab: "threads", cursor: "prev" });
		expect(result.threads.prevCursor).toBe("prev");
	});
});
