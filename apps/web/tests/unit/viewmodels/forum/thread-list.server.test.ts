import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAuth: vi.fn(),
		getAll: vi.fn(),
		getCursor: vi.fn(),
		getCursorAuth: vi.fn(),
		postAuth: vi.fn(),
	},
	publicUserToUser: (user: unknown) => user,
}));
vi.mock("@/lib/forum-cache", () => ({
	getCachedForumList: vi.fn(),
	getCachedForumStructure: vi.fn(async () => ({ forums: mockForums, bucket: "anon" })),
	getCachedThreadById: vi.fn(),
	getCachedPageSize: vi.fn(async () => 20),
}));
vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: vi.fn(async () => null) }));
vi.mock("@/lib/forum-reading", () => ({ loadThreadCount: vi.fn(async () => 50) }));
vi.mock("@/lib/forum-breadcrumbs", () => ({
	buildForumBreadcrumbs: vi.fn(() => [{ label: "首页", href: "/" }]),
}));
vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: vi.fn(async () => ({})),
	getStr: (_settings: unknown, _key: string, fallback: string) => fallback,
}));

import { forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { getCachedForumStructure } from "@/lib/forum-cache";
import { loadThreadCount } from "@/lib/forum-reading";
import { loadThreadList, loadThreadListPaged } from "@/viewmodels/forum/thread-list.server";

const api = forumApi as unknown as {
	get: ReturnType<typeof vi.fn>;
	getAuth: ReturnType<typeof vi.fn>;
	getAll: ReturnType<typeof vi.fn>;
	getCursor: ReturnType<typeof vi.fn>;
	getCursorAuth: ReturnType<typeof vi.fn>;
};
const mockStructure = getCachedForumStructure as ReturnType<typeof vi.fn>;
const mockCount = loadThreadCount as ReturnType<typeof vi.fn>;

const mockForums = [
	{
		id: 1,
		parentId: 0,
		name: "General",
		status: 1,
		visibility: "public",
		type: "forum",
		threads: 0,
		posts: 0,
		displayOrder: 1,
		moderators: "",
		moderatorIds: "",
		moderatorList: [],
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		threadTypes: { enabled: false, required: false, listable: false, prefix: false, types: [] },
	},
	{
		id: 2,
		parentId: 1,
		name: "Sub Forum",
		status: 1,
		visibility: "public",
		type: "forum",
		threads: 0,
		posts: 0,
		displayOrder: 1,
		moderators: "",
		moderatorIds: "",
		moderatorList: [],
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		threadTypes: { enabled: false, required: false, listable: false, prefix: false, types: [] },
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

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getWorkerJwt).mockResolvedValue(null);
	mockStructure.mockResolvedValue({ forums: mockForums, bucket: "anon" });
	mockCount.mockResolvedValue(50);
	api.getCursor.mockResolvedValue({ data: mockThreads, meta: { nextCursor: "abc" } });
	api.get.mockResolvedValue({ data: mockThreads, meta: { page: 1, hasNext: true, limit: 20 } });
});

describe("loadThreadList", () => {
	it("loads the forum structure and cursor page, preserving list behavior", async () => {
		const result = await loadThreadList({ forumId: 1 });
		expect(mockStructure).toHaveBeenCalledWith(null);
		expect(api.getCursor).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			limit: 20,
			cursor: undefined,
		});
		expect(result.forum?.id).toBe(1);
		expect(result.items).toHaveLength(1);
		expect(result.nextCursor).toBe("abc");
		expect(result.total).toBe(50);
	});

	it("forwards the current JWT to structure and thread data", async () => {
		vi.mocked(getWorkerJwt).mockResolvedValue("jwt");
		api.getCursorAuth.mockResolvedValue({ data: mockThreads, meta: { nextCursor: null } });
		await loadThreadList({ forumId: 1 });
		expect(mockStructure).toHaveBeenCalledWith("jwt");
		expect(api.getCursorAuth).toHaveBeenCalledWith("/api/v1/threads", "jwt", {
			forumId: 1,
			limit: 20,
			cursor: undefined,
		});
	});
});

describe("loadThreadListPaged — offset reads", () => {
	it("requests an offset page without total and uses the authoritative count", async () => {
		const result = await loadThreadListPaged({ forumId: 1 });
		expect(api.get).toHaveBeenCalledWith("/api/v1/threads", {
			forumId: 1,
			page: 1,
			limit: 20,
			includeTotal: false,
		});
		expect(mockCount).toHaveBeenCalledWith(1, null, "anon", null);
		expect(result).toMatchObject({ page: 1, total: 50, limit: 20, pages: 3, hasNext: true });
	});

	it("forwards custom page, limit, type and JWT to the list, count and structure reads", async () => {
		vi.mocked(getWorkerJwt).mockResolvedValue("member-jwt");
		api.getAuth.mockResolvedValue({
			data: mockThreads,
			meta: { page: 4, hasNext: false, limit: 10 },
		});
		await loadThreadListPaged({ forumId: 2, page: 4, limit: 10, typeId: 9 });
		expect(mockStructure).toHaveBeenCalledWith("member-jwt");
		expect(api.getAuth).toHaveBeenCalledWith("/api/v1/threads", "member-jwt", {
			forumId: 2,
			page: 4,
			limit: 10,
			includeTotal: false,
			typeId: 9,
		});
		expect(mockCount).toHaveBeenCalledWith(2, 9, "anon", "member-jwt");
	});

	it("starts the list request while badge configuration is still pending", async () => {
		let release!: (value: boolean) => void;
		const badge = new Promise<boolean>((resolve) => {
			release = resolve;
		});
		const result = loadThreadListPaged({ forumId: 1, includeTypeNameBadge: badge });
		for (let i = 0; i < 8; i += 1) await Promise.resolve();
		expect(api.get).toHaveBeenCalledOnce();
		release(false);
		expect((await result).items).toHaveLength(1);
	});

	it("never requests a count when the list request fails", async () => {
		api.get.mockRejectedValueOnce(new Error("list denied"));
		await expect(loadThreadListPaged({ forumId: 1 })).rejects.toThrow("list denied");
		expect(mockCount).not.toHaveBeenCalled();
	});

	it("keeps the real page reachable when cached total is low and preserves empty final page", async () => {
		api.get.mockResolvedValue({ data: [], meta: { page: 7, hasNext: false, limit: 20 } });
		mockCount.mockResolvedValue(5);
		const result = await loadThreadListPaged({ forumId: 1, page: 7 });
		expect(result.pages).toBe(7);
		expect(result.page).toBe(7);
		expect(result.items).toEqual([]);
	});

	it("extends the page lower bound by one while hasNext holds", async () => {
		api.get.mockResolvedValue({ data: mockThreads, meta: { page: 2, hasNext: true, limit: 20 } });
		mockCount.mockResolvedValue(5);
		const result = await loadThreadListPaged({ forumId: 1, page: 2 });
		expect(result.pages).toBe(3);
	});

	it("enriches list rows with the returned badge policy", async () => {
		api.get.mockResolvedValue({
			data: [{ ...mockThreads[0], typeName: "求购" }],
			meta: { page: 1, hasNext: false, limit: 20 },
		});
		const result = await loadThreadListPaged({ forumId: 1, includeTypeNameBadge: false });
		expect(result.items[0]?.badges.some((badge) => badge.type === "typeName")).toBe(false);
	});
});
