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
	getCachedForumList: vi.fn(async () => [
		{ id: 1, name: "灌水区" },
		{ id: 2, name: "技术区" },
	]),
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

/**
 * Helper: build a full PostThreadSummary-shaped fixture that satisfies
 * `isUserPostHistoryItem`. Keep the per-test overrides surgical so each
 * scenario reads as data-driven rather than copy-pasted.
 */
function makeHistoryItem(
	postOverrides: Record<string, unknown> = {},
	threadOverrides: Record<string, unknown> = {},
) {
	return {
		post: { id: 10, createdAt: 123, ...postOverrides },
		thread: {
			id: 1,
			forumId: 1,
			subject: "T",
			replies: 0,
			views: 0,
			createdAt: 100,
			lastPostAt: 100,
			closed: 0,
			sticky: 0,
			digest: 0,
			special: 0,
			highlight: 0,
			typeName: "",
			...threadOverrides,
		},
	};
}

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
		mockForumApi.getCursor.mockResolvedValue({
			data: [makeHistoryItem()],
			meta: { nextCursor: null },
		});
		const result = await loadUserProfile({ userId: 42, tab: "posts" });
		expect(result.tab).toBe("posts");
		expect(result.posts.items.length).toBe(1);
		expect(result.postsShape).toBe("history");
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

	it("builds forumsById from the cached forum list", async () => {
		const result = await loadUserProfile({ userId: 42 });
		// Map is forumId → name; covers every forum from the cached list so
		// each row can resolve its board chip without an extra request.
		expect(result.forumsById).toEqual({ 1: "灌水区", 2: "技术区" });
	});

	describe("posts tab — backend shape compatibility", () => {
		it("flags legacy Post[] payload as postsShape='legacy' and suppresses items/total", async () => {
			// Old Worker returns flat Post objects without the joined `thread`.
			// The loader must NOT cast — render would crash on `post.createdAt`.
			mockForumApi.getCursor.mockResolvedValue({
				data: [
					{ id: 10, threadId: 1, createdAt: 111, content: "hi" },
					{ id: 11, threadId: 1, createdAt: 112, content: "yo" },
				],
				meta: { nextCursor: "should-be-suppressed" },
			});
			const result = await loadUserProfile({ userId: 42, tab: "posts" });
			expect(result.postsShape).toBe("legacy");
			expect(result.posts.items).toEqual([]);
			expect(result.posts.nextCursor).toBeNull();
			expect(result.posts.prevCursor).toBeNull();
			// Total must NOT show user.posts (20) — pagination shouldn't claim
			// pages the user can't actually navigate to.
			expect(result.posts.total).toBe(0);
		});

		it("accepts new UserPostHistoryItem shape and exposes postsShape='history'", async () => {
			mockForumApi.getCursor.mockResolvedValue({
				data: [
					makeHistoryItem(
						{ id: 50, createdAt: 200 },
						{ id: 1, forumId: 1, subject: "Hello", replies: 1, views: 2, lastPostAt: 200 },
					),
				],
				meta: { nextCursor: "next" },
			});
			const result = await loadUserProfile({ userId: 42, tab: "posts" });
			expect(result.postsShape).toBe("history");
			expect(result.posts.items.length).toBe(1);
			expect(result.posts.nextCursor).toBe("next");
			expect(result.posts.total).toBe(20); // user.posts
		});

		it("partial thread (missing fields the row reads) is rejected as legacy", async () => {
			// `post`+`thread` envelopes look right but `thread.replies` is gone.
			// `formatCompactNumber(thread.replies)` in UserProfileListRow would
			// crash on this — the guard must catch it BEFORE we render.
			mockForumApi.getCursor.mockResolvedValue({
				data: [
					{
						post: { id: 50, createdAt: 200 },
						thread: { id: 1, forumId: 1, subject: "Hello" /* replies/views/... missing */ },
					},
				],
				meta: { nextCursor: null },
			});
			const result = await loadUserProfile({ userId: 42, tab: "posts" });
			expect(result.postsShape).toBe("legacy");
			expect(result.posts.items).toEqual([]);
		});

		it("missing thread.lastPostAt is rejected as legacy", async () => {
			mockForumApi.getCursor.mockResolvedValue({
				data: [
					makeHistoryItem(
						{},
						{
							lastPostAt: undefined as unknown as number,
						},
					),
				],
				meta: { nextCursor: null },
			});
			const result = await loadUserProfile({ userId: 42, tab: "posts" });
			expect(result.postsShape).toBe("legacy");
		});

		it("empty data array is treated as history shape (zero replies), not legacy", async () => {
			mockForumApi.getCursor.mockResolvedValue({ data: [], meta: { nextCursor: null } });
			const result = await loadUserProfile({ userId: 42, tab: "posts" });
			expect(result.postsShape).toBe("history");
			expect(result.posts.items).toEqual([]);
		});

		it("non-posts tabs always report postsShape='history' (default)", async () => {
			const result = await loadUserProfile({ userId: 42, tab: "threads" });
			expect(result.postsShape).toBe("history");
		});
	});
});
