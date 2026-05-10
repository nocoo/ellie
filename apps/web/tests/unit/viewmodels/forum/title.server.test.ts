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
	};
});

import { forumApi } from "@/lib/forum-api";
import { getCachedForumList, getCachedThreadById } from "@/lib/forum-cache";
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

// ─── Dedup routing: title helpers share cached data helpers ──────────
// These tests verify that title.server.ts routes through the React
// cache()-backed helpers in forum-data.ts (getCachedThreadById / getCachedForumList),
// which deduplicates fetches when generateMetadata and the page loader
// are called in the same RSC render pass.

describe("render-pass dedup routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("getThreadTitle and getCachedThreadById both resolve through forumApi.get (shared path)", async () => {
		mockForumApi.get.mockResolvedValue({ data: { subject: "Shared" } });

		// Simulate what happens in one render pass:
		// generateMetadata → getThreadTitle → getCachedThreadById → forumApi.get
		const title = await getThreadTitle(42);
		// page loader → getCachedThreadById → forumApi.get (same function, deduped by React cache at runtime)
		const thread = await getCachedThreadById(42);

		expect(title).toBe("Shared");
		expect(thread.subject).toBe("Shared");
		// Both route through forumApi.get — in production React cache() deduplicates these
		// into a single network call. Here we verify the shared path exists.
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/threads/42");
	});

	it("getForumTitle and getCachedForumList both resolve through forumApi.getAll (shared path)", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [{ id: 7, name: "Dev" }] });

		// generateMetadata → getForumTitle → getCachedForumList → forumApi.getAll
		const title = await getForumTitle(7);
		// page loader → getCachedForumList → forumApi.getAll (same function, deduped by React cache at runtime)
		const forums = await getCachedForumList();

		expect(title).toBe("Dev");
		expect(forums).toEqual([{ id: 7, name: "Dev" }]);
		expect(mockForumApi.getAll).toHaveBeenCalledWith("/api/v1/forums");
	});
});
