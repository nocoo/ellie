import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: vi.fn(),
		getList: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
		put: vi.fn(),
		delete: vi.fn(),
	},
}));

import { apiClient } from "@/lib/api-client";
import {
	fetchFeatureSettings,
	updateSettings as updateFeatures,
} from "@/viewmodels/admin/features";
import {
	createForum,
	deleteForum,
	fetchForum,
	fetchForums,
	mergeForums,
	reorderForums,
	updateForum,
} from "@/viewmodels/admin/forums";
import { updateSettings } from "@/viewmodels/admin/settings";
import { fetchThreadPosts, loadThreadDetail } from "@/viewmodels/admin/thread-detail";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockGetList = apiClient.getList as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockPatch = apiClient.patch as ReturnType<typeof vi.fn>;
const mockPut = apiClient.put as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("forums API", () => {
	it("fetchForums calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchForums();
		expect(mockGetList).toHaveBeenCalledWith("/api/admin/forums");
	});

	it("fetchForum calls get by id", async () => {
		mockGet.mockResolvedValue({ data: { id: 1 } });
		const f = await fetchForum(1);
		expect(f.id).toBe(1);
	});

	it("createForum calls post", async () => {
		mockPost.mockResolvedValue({ data: { id: 1, name: "New" } });
		const f = await createForum({ name: "New" });
		expect(f.name).toBe("New");
	});

	it("updateForum calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1 } });
		await updateForum(1, { name: "Updated" });
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/forums/1", { name: "Updated" });
	});

	it("deleteForum calls delete", async () => {
		mockDelete.mockResolvedValue({ data: { deleted: true } });
		const r = await deleteForum(1);
		expect(r.deleted).toBe(true);
	});

	it("mergeForums calls post", async () => {
		mockPost.mockResolvedValue({ data: { merged: true, movedThreads: 10 } });
		const r = await mergeForums(1, 2);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/forums/1/merge", { targetForumId: 2 });
		expect(r.merged).toBe(true);
	});

	it("reorderForums calls post", async () => {
		mockPost.mockResolvedValue({ data: { reordered: true } });
		const r = await reorderForums([{ id: 1, displayOrder: 1 }]);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/forums/reorder", {
			orders: [{ id: 1, displayOrder: 1 }],
		});
		expect(r.reordered).toBe(true);
	});
});

describe("thread-detail API", () => {
	it("fetchThreadPosts calls fetchPosts with sort", async () => {
		mockGetList.mockResolvedValue({
			data: [{ id: 1, authorId: 10 }],
			meta: { total: 1, page: 1, limit: 20, pages: 1 },
		});
		const result = await fetchThreadPosts(42, 1, 20);
		expect(mockGetList).toHaveBeenCalledWith(
			"/api/admin/posts",
			expect.objectContaining({ threadId: 42, sort: "position_asc" }),
		);
		expect(result.data).toHaveLength(1);
	});

	it("loadThreadDetail fetches thread + posts + authors", async () => {
		mockGet.mockImplementation(async (path: string) => {
			if (path.includes("/threads/")) return { data: { id: 42, subject: "Test" } };
			if (path.includes("/users/batch")) return { data: [{ id: 10, username: "alice" }] };
			return { data: {} };
		});
		mockGetList.mockResolvedValue({
			data: [{ id: 1, authorId: 10, threadId: 42 }],
			meta: { total: 1, page: 1, limit: 20, pages: 1, timestamp: 1, requestId: "r1" },
		});
		const detail = await loadThreadDetail(42);
		expect(detail.thread.id).toBe(42);
		expect(detail.posts).toHaveLength(1);
		expect(detail.posts[0].author?.username).toBe("alice");
	});
});

describe("settings API", () => {
	it("updateSettings calls put", async () => {
		mockPut.mockResolvedValue({ data: { updated: 3 } });
		const r = await updateSettings({ "general.site.name": "X" });
		expect(mockPut).toHaveBeenCalledWith("/api/admin/settings", { "general.site.name": "X" });
		expect(r.updated).toBe(3);
	});
});

describe("features API", () => {
	it("fetchFeatureSettings calls get", async () => {
		mockGet.mockResolvedValue({
			data: { "features.access.require_login": { value: "true", type: "boolean", updatedAt: 1 } },
		});
		const r = await fetchFeatureSettings();
		expect(mockGet).toHaveBeenCalledWith("/api/admin/settings?prefix=features.");
		expect(r["features.access.require_login"].value).toBe("true");
	});

	it("updateFeatures calls put", async () => {
		mockPut.mockResolvedValue({ data: { updated: 1 } });
		const r = await updateFeatures({ "features.access.require_login": "false" });
		expect(r.updated).toBe(1);
	});
});
