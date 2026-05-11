import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAll: vi.fn(),
		getCursor: vi.fn(),
		getPage: vi.fn(),
		post: vi.fn(),
		postAuth: vi.fn(),
	},
	publicUserToUser: vi.fn((u: any) => ({
		...u,
		id: u.userId ?? u.id,
		email: "",
		avatar: "",
		avatarPath: "",
		status: 0,
		regDate: 0,
		lastLogin: 0,
		threads: 0,
		posts: 0,
		credits: 0,
		signature: "",
		groupTitle: "",
		groupStars: 0,
		groupColor: "",
		customTitle: "",
		digestPosts: 0,
		olTime: 0,
		lastActivity: 0,
		gender: 0,
		birthYear: 0,
		birthMonth: 0,
		birthDay: 0,
		resideProvince: "",
		resideCity: "",
		graduateSchool: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
	})),
}));

// Mock forum-cache to delegate cached fetchers to forumApi mocks
// (avoids cross-file module isolation issues with React cache()) and to
// stub the page-size convenience helpers.
vi.mock("@/lib/forum-cache", async () => {
	const { forumApi } = await import("@/lib/forum-api");
	return {
		getCachedThreadById: async (id: number) => {
			const res = await (forumApi as any).get(`/api/v1/threads/${id}`);
			return res.data;
		},
		getCachedForumList: async () => {
			const res = await (forumApi as any).getAll("/api/v1/forums");
			return res.data;
		},
		getCachedPostsPerPage: vi.fn(async () => 20),
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getCurrentForumUser: vi.fn(async () => null),
	getWorkerJwt: vi.fn(async () => null),
}));

vi.mock("@/lib/forum-breadcrumbs", () => ({
	buildThreadBreadcrumbs: vi.fn(() => [{ label: "首页", href: "/" }, { label: "Test" }]),
}));

import { forumApi } from "@/lib/forum-api";
import { getCurrentForumUser } from "@/lib/forum-auth";
import { loadThreadDetail } from "@/viewmodels/forum/thread-detail.server";

const mockForumApi = forumApi as any;
const mockGetCurrentForumUser = getCurrentForumUser as ReturnType<typeof vi.fn>;

const mockThread = {
	id: 1,
	forumId: 10,
	subject: "Hello",
	authorId: 100,
	authorName: "user1",
	views: 5,
	replies: 1,
	lastPostAt: 1000,
	lastPostBy: "user2",
	createdAt: 900,
	sticky: 0,
	digest: 0,
	highlight: "",
	closed: 0,
	special: 0,
	displayOrder: 0,
};
const mockForums = [
	{
		id: 10,
		parentId: 0,
		name: "General",
		status: 1,
		threads: 10,
		posts: 50,
		displayOrder: 1,
		moderators: "mod1",
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
const mockPosts = [
	{
		id: 200,
		threadId: 1,
		authorId: 100,
		content: "<p>Hello</p>",
		createdAt: 900,
		position: 1,
		invisible: 0,
		anonymous: 0,
		useSig: 0,
		htmlOn: 0,
		bbcodeOff: 0,
		smileyOff: 0,
		first: 1,
		status: 0,
	},
];

describe("loadThreadDetail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.get.mockImplementation((path: string) => {
			if (path.startsWith("/api/v1/threads/")) return Promise.resolve({ data: mockThread });
			if (path.startsWith("/api/v1/users/"))
				return Promise.resolve({ data: { id: 100, userId: 100, username: "user1", role: 0 } });
			return Promise.resolve({ data: null });
		});
		mockForumApi.getAll.mockImplementation((path: string) => {
			if (path.includes("users/batch"))
				return Promise.resolve({ data: [{ id: 100, userId: 100, username: "user1", role: 0 }] });
			if (path.includes("forums")) return Promise.resolve({ data: mockForums });
			return Promise.resolve({ data: [] });
		});
		mockForumApi.getCursor.mockResolvedValue({ data: mockPosts, meta: { nextCursor: null } });
		// Batch attachments and comments endpoints
		mockForumApi.post.mockImplementation((path: string) => {
			if (path.includes("attachments/batch")) return Promise.resolve({ data: [] });
			if (path.includes("post-comments/batch")) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: null });
		});
	});

	it("returns thread detail with posts, forum, and breadcrumbs", async () => {
		const result = await loadThreadDetail({ threadId: 1 });

		expect(result.thread).toEqual(mockThread);
		expect(result.forum?.id).toBe(10);
		expect(result.posts.length).toBe(1);
		expect(result.breadcrumbs.length).toBeGreaterThan(0);
		expect(result.nextCursor).toBeNull();
	});

	it("returns null currentUser when no session", async () => {
		const result = await loadThreadDetail({ threadId: 1 });
		expect(result.currentUser).toBeNull();
		expect(result.canModerateForum).toBe(false);
		expect(result.canManageThread).toBe(false);
		expect(result.canMoveThread).toBe(false);
		expect(result.canDeleteThread).toBe(false);
	});

	it("builds currentUser from session and checks permissions", async () => {
		mockGetCurrentForumUser.mockResolvedValue({ userId: 50, username: "admin", role: 3 });
		const result = await loadThreadDetail({ threadId: 1 });
		expect(result.currentUser).not.toBeNull();
		expect(result.currentUser?.id).toBe(50);
	});

	it("passes limit and cursor to posts API", async () => {
		await loadThreadDetail({ threadId: 1, limit: 10, cursor: "abc" });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith("/api/v1/posts", {
			threadId: 1,
			limit: 10,
			cursor: "abc",
		});
	});

	it("handles attachment fetch failures gracefully", async () => {
		mockForumApi.post.mockImplementation((path: string) => {
			if (path.includes("attachments/batch")) return Promise.reject(new Error("fail"));
			if (path.includes("post-comments/batch")) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: null });
		});
		const result = await loadThreadDetail({ threadId: 1 });
		expect(result.posts[0].attachments).toEqual([]);
	});

	it("handles comment fetch failures by signaling client refetch (undefined)", async () => {
		mockForumApi.post.mockImplementation((path: string) => {
			if (path.includes("attachments/batch")) return Promise.resolve({ data: [] });
			if (path.includes("post-comments/batch")) return Promise.reject(new Error("fail"));
			return Promise.resolve({ data: null });
		});
		const result = await loadThreadDetail({ threadId: 1 });
		// New contract (rev): SSR batch failure now surfaces as `undefined` so
		// PostComments client fetches as fallback. The legacy silent-empty
		// behavior was the L3 e2e regression source.
		expect(result.posts[0].comments).toBeUndefined();
	});

	it("falls back to post.authorName when users/batch fails (link must still render)", async () => {
		mockForumApi.getAll.mockImplementation((path: string) => {
			if (path.includes("users/batch")) return Promise.reject(new Error("not found"));
			if (path.includes("forums")) return Promise.resolve({ data: mockForums });
			return Promise.resolve({ data: [] });
		});
		// Add an authorName to the post fixture so the fallback has something
		// to construct from (production rows always carry it).
		mockForumApi.getCursor.mockResolvedValueOnce({
			data: [{ ...mockPosts[0], authorName: "user1" }],
			meta: { nextCursor: null },
		});
		const result = await loadThreadDetail({ threadId: 1 });
		// Author must NOT be null — E2E-PO-01 asserts the `<Link href="/users/N">`
		// renders even when /users/batch is unreachable.
		expect(result.posts[0].author).not.toBeNull();
		expect(result.posts[0].author?.id).toBe(100);
		expect(result.posts[0].author?.username).toBe("user1");
	});

	it("renders author=null when users/batch fails AND post row has no authorName (no fabrication)", async () => {
		mockForumApi.getAll.mockImplementation((path: string) => {
			if (path.includes("users/batch")) return Promise.reject(new Error("not found"));
			if (path.includes("forums")) return Promise.resolve({ data: mockForums });
			return Promise.resolve({ data: [] });
		});
		// Force authorName empty so the fallback has nothing to construct from.
		mockForumApi.getCursor.mockResolvedValueOnce({
			data: [{ ...mockPosts[0], authorName: "" }],
			meta: { nextCursor: null },
		});
		const result = await loadThreadDetail({ threadId: 1 });
		// We must NOT invent identity; null is the correct outcome here.
		expect(result.posts[0].author).toBeNull();
	});

	it("injects batch comments into enriched posts by postId", async () => {
		const posts = [
			{ ...mockPosts[0], id: 200, authorId: 100 },
			{ ...mockPosts[0], id: 201, authorId: 100 },
		];
		mockForumApi.getCursor.mockResolvedValue({ data: posts, meta: { nextCursor: null } });
		mockForumApi.post.mockImplementation((path: string) => {
			if (path.includes("attachments/batch")) return Promise.resolve({ data: [] });
			if (path.includes("post-comments/batch"))
				return Promise.resolve({
					data: [
						{
							id: 1,
							threadId: 1,
							postId: 200,
							authorId: 50,
							authorName: "commenter",
							content: "Nice!",
							score: 0,
							replyPostId: 0,
							createdAt: 1000,
						},
						{
							id: 2,
							threadId: 1,
							postId: 200,
							authorId: 51,
							authorName: "commenter2",
							content: "Agree",
							score: 0,
							replyPostId: 0,
							createdAt: 1001,
						},
					],
				});
			return Promise.resolve({ data: null });
		});

		const result = await loadThreadDetail({ threadId: 1 });
		// Post 200 should have 2 comments
		expect(result.posts[0].comments).toHaveLength(2);
		expect(result.posts[0].comments[0].content).toBe("Nice!");
		// Post 201 should have 0 comments
		expect(result.posts[1].comments).toHaveLength(0);

		// Pin endpoint and body contract
		expect(mockForumApi.post).toHaveBeenCalledWith("/api/v1/post-comments/batch", {
			threadId: 1,
			postIds: [200, 201],
		});
	});

	it("returns forum as null when thread forumId not in list", async () => {
		mockForumApi.get.mockImplementation((path: string) => {
			if (path.startsWith("/api/v1/threads/"))
				return Promise.resolve({ data: { ...mockThread, forumId: 999 } });
			if (path.startsWith("/api/v1/users/"))
				return Promise.resolve({ data: { id: 100, userId: 100, username: "user1", role: 0 } });
			return Promise.resolve({ data: null });
		});
		const result = await loadThreadDetail({ threadId: 1 });
		expect(result.forum).toBeNull();
	});

	// ─── N+1 regression: pin API request counts ────────────────
	// These tests ensure that batch optimizations are not regressed.
	// With batch endpoints, call counts are constant regardless of post/author count.

	it("makes exactly 6 API calls for a page with 3 posts by 2 authors (batch optimized)", async () => {
		const posts = [
			{ ...mockPosts[0], id: 200, authorId: 100, authorName: "user1" },
			{ ...mockPosts[0], id: 201, authorId: 100, authorName: "user1" },
			{ ...mockPosts[0], id: 202, authorId: 200, authorName: "user2" },
		];
		mockForumApi.getCursor.mockResolvedValue({ data: posts, meta: { nextCursor: null } });

		await loadThreadDetail({ threadId: 1 });

		// get: 1 thread GET only (no per-user GETs)
		expect(mockForumApi.get).toHaveBeenCalledTimes(1);
		// getAll: 1 forums + 1 users/batch = 2
		expect(mockForumApi.getAll).toHaveBeenCalledTimes(2);
		// getCursor: 1 posts
		expect(mockForumApi.getCursor).toHaveBeenCalledTimes(1);
		// post: 1 attachments/batch + 1 comments/batch = 2
		expect(mockForumApi.post).toHaveBeenCalledTimes(2);
		// Total HTTP calls: 1 + 2 + 1 + 2 = 6 (constant)
	});

	it("API call count is constant regardless of post/author count (N+1 eliminated)", async () => {
		// 10 posts by 5 unique authors — same call count as 3 posts by 2 authors
		const posts = Array.from({ length: 10 }, (_, i) => ({
			...mockPosts[0],
			id: 300 + i,
			authorId: 500 + (i % 5),
			authorName: `author${i % 5}`,
		}));
		mockForumApi.getCursor.mockResolvedValue({ data: posts, meta: { nextCursor: null } });

		await loadThreadDetail({ threadId: 1 });

		// get: 1 thread (constant)
		expect(mockForumApi.get).toHaveBeenCalledTimes(1);
		// getAll: 1 forums + 1 users/batch = 2 (constant)
		expect(mockForumApi.getAll).toHaveBeenCalledTimes(2);
		// getCursor: 1 posts (constant)
		expect(mockForumApi.getCursor).toHaveBeenCalledTimes(1);
		// post: 1 attachments/batch + 1 comments/batch = 2 (constant)
		expect(mockForumApi.post).toHaveBeenCalledTimes(2);
		// Total: 6 — same as 3 posts. N+1 is gone.
	});
});
