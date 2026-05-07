import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: {
		get: vi.fn(),
		getList: vi.fn(),
		post: vi.fn(),
		patch: vi.fn(),
		delete: vi.fn(),
	},
}));

import { apiClient } from "@/lib/api-client";
import {
	batchDeleteThreads,
	batchMoveThreads,
	deleteThread,
	fetchThread,
	fetchThreads,
	updateThread,
} from "@/viewmodels/admin/threads";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockGetList = apiClient.getList as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockPatch = apiClient.patch as ReturnType<typeof vi.fn>;
const mockDelete = apiClient.delete as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

describe("threads API functions", () => {
	it("fetchThreads calls getList", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchThreads({ page: 1, forumId: 5 });
		expect(mockGetList).toHaveBeenCalledWith(
			"/api/admin/threads",
			expect.objectContaining({ page: 1, forumId: 5 }),
		);
	});

	it("fetchThread calls get by id", async () => {
		mockGet.mockResolvedValue({ data: { id: 42 } });
		const t = await fetchThread(42);
		expect(mockGet).toHaveBeenCalledWith("/api/admin/threads/42");
		expect(t.id).toBe(42);
	});

	it("updateThread calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1, sticky: 1 } });
		const t = await updateThread(1, { sticky: 1 });
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/threads/1", { sticky: 1 });
		expect(t.sticky).toBe(1);
	});

	it("deleteThread calls delete", async () => {
		mockDelete.mockResolvedValue({ data: { deleted: true, deletedPosts: 5 } });
		const r = await deleteThread(1);
		expect(mockDelete).toHaveBeenCalledWith("/api/admin/threads/1");
		expect(r.deleted).toBe(true);
	});

	it("batchDeleteThreads calls post and returns worker `{deleted,count}` shape", async () => {
		// Mirrors worker `handlers/admin/thread.ts` batchDelete:
		//   return jsonResponse({ deleted: true, count: existingIds.length }, ...)
		// Locked here so a future rename (e.g. back to `affected`) trips this
		// test before it can render `undefined` in the success banner.
		mockPost.mockResolvedValue({ data: { deleted: true, count: 3 } });
		const r = await batchDeleteThreads([1, 2, 3]);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/threads/batch-delete", { ids: [1, 2, 3] });
		expect(r.deleted).toBe(true);
		expect(r.count).toBe(3);
	});

	it("batchMoveThreads calls post and returns worker `{moved,count,forumId}` shape", async () => {
		// Mirrors worker batchMove:
		//   return jsonResponse({ moved: true, count, forumId: targetForumId }, ...)
		mockPost.mockResolvedValue({ data: { moved: true, count: 2, forumId: 10 } });
		const r = await batchMoveThreads([1, 2], 10);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/threads/batch-move", {
			ids: [1, 2],
			forumId: 10,
		});
		expect(r.moved).toBe(true);
		expect(r.count).toBe(2);
		expect(r.forumId).toBe(10);
	});
});
