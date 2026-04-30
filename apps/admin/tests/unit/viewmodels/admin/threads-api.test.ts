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

	it("batchDeleteThreads calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 3 } });
		const r = await batchDeleteThreads([1, 2, 3]);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/threads/batch-delete", { ids: [1, 2, 3] });
		expect(r.affected).toBe(3);
	});

	it("batchMoveThreads calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 2 } });
		const r = await batchMoveThreads([1, 2], 10);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/threads/batch-move", {
			ids: [1, 2],
			forumId: 10,
		});
		expect(r.affected).toBe(2);
	});
});
