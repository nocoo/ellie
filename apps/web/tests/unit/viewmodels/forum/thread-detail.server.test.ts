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

vi.mock("@/lib/forum-auth", () => ({
	getCurrentForumUser: vi.fn(async () => null),
	getWorkerJwt: vi.fn(async () => null),
}));

vi.mock("@/lib/forum-settings", () => ({
	getPostsPerPage: vi.fn(async () => 20),
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
			if (path.includes("attachments")) return Promise.resolve({ data: [] });
			if (path.includes("forums")) return Promise.resolve({ data: mockForums });
			return Promise.resolve({ data: [] });
		});
		mockForumApi.getCursor.mockResolvedValue({ data: mockPosts, meta: { nextCursor: null } });
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
		mockForumApi.getAll.mockImplementation((path: string) => {
			if (path.includes("attachments")) return Promise.reject(new Error("fail"));
			if (path.includes("forums")) return Promise.resolve({ data: mockForums });
			return Promise.resolve({ data: [] });
		});
		const result = await loadThreadDetail({ threadId: 1 });
		expect(result.posts[0].attachments).toEqual([]);
	});

	it("handles author fetch failures gracefully", async () => {
		mockForumApi.get.mockImplementation((path: string) => {
			if (path.startsWith("/api/v1/threads/")) return Promise.resolve({ data: mockThread });
			if (path.startsWith("/api/v1/users/")) return Promise.reject(new Error("not found"));
			return Promise.resolve({ data: null });
		});
		const result = await loadThreadDetail({ threadId: 1 });
		expect(result.posts[0].author).toBeNull();
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
});
