import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/forum-cache", () => ({
	getCachedForumListContext: mocks.context,
	getCachedPostsPerPage: async () => 20,
}));
vi.mock("@/viewmodels/forum/settings.server", () => ({
	fetchPublicSettings: vi.fn(async () => ({})),
	getStr: (_s: unknown, _k: string, fallback: string) => fallback,
}));

import { loadThreadListPaged } from "@/viewmodels/forum/thread-list.server";

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

function context(extra = {}) {
	return {
		forumId: 1,
		display: {
			forums: mockForums,
			threads: mockThreads,
			threadTypes: { enabled: true, listable: true, prefix: true, types: [] },
			recommended: [],
		},
		page: 1,
		limit: 20,
		total: 50,
		hasNext: true,
		user: null,
		typeId: null,
		...extra,
	};
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.context.mockResolvedValue(context());
});
describe("forum list page model", () => {
	it("composes header, descendants and rows from one authorized context", async () => {
		const result = await loadThreadListPaged(1);
		expect(mocks.context).toHaveBeenCalledOnce();
		expect(result.forum?.children[0].id).toBe(2);
		expect(result.items[0].thread.id).toBe(100);
		expect(result.pages).toBe(3);
		expect(result.breadcrumbs.length).toBeGreaterThan(0);
	});
	it("finds nested forums and keeps the requested empty page reachable", async () => {
		mocks.context.mockResolvedValue(context({ forumId: 2, page: 7, total: 0, hasNext: false }));
		expect((await loadThreadListPaged(2)).pages).toBe(7);
	});
	it("uses authoritative next-page existence despite an approximate total", async () => {
		mocks.context.mockResolvedValue(context({ page: 3, total: 0, hasNext: true }));
		expect((await loadThreadListPaged(1)).pages).toBe(4);
	});
	it("rejects a missing forum and propagates authorization failures", async () => {
		mocks.context.mockResolvedValue(context({ forumId: 999 }));
		await expect(loadThreadListPaged(999)).rejects.toThrow("missing");
		mocks.context.mockRejectedValue(new Error("denied"));
		await expect(loadThreadListPaged(1)).rejects.toThrow("denied");
	});
});
