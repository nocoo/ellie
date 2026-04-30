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
	banUser,
	batchSetRole,
	batchSetStatus,
	fetchUser,
	fetchUsers,
	fetchUsersByIds,
	nukeUser,
	updateUser,
} from "@/viewmodels/admin/users";

const mockGet = apiClient.get as ReturnType<typeof vi.fn>;
const mockGetList = apiClient.getList as ReturnType<typeof vi.fn>;
const mockPost = apiClient.post as ReturnType<typeof vi.fn>;
const mockPatch = apiClient.patch as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("users API functions", () => {
	it("fetchUsers calls getList with correct params", async () => {
		mockGetList.mockResolvedValue({ data: [], meta: {} });
		await fetchUsers({ page: 1, limit: 20, username: "john" });
		expect(mockGetList).toHaveBeenCalledWith(
			"/api/admin/users",
			expect.objectContaining({ page: 1, username: "john" }),
		);
	});

	it("fetchUser calls get with user id", async () => {
		mockGet.mockResolvedValue({ data: { id: 1 } });
		const user = await fetchUser(1);
		expect(mockGet).toHaveBeenCalledWith("/api/admin/users/1");
		expect(user.id).toBe(1);
	});

	it("updateUser calls patch", async () => {
		mockPatch.mockResolvedValue({ data: { id: 1, role: 1 } });
		const user = await updateUser(1, { role: 1 });
		expect(mockPatch).toHaveBeenCalledWith("/api/admin/users/1", { role: 1 });
		expect(user.role).toBe(1);
	});

	it("banUser calls post with deleteContent", async () => {
		mockPost.mockResolvedValue({ data: { banned: true } });
		const result = await banUser(42, true);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/users/42/ban", { deleteContent: true });
		expect(result.banned).toBe(true);
	});

	it("nukeUser calls post", async () => {
		mockPost.mockResolvedValue({ data: { nuked: true, deletedThreads: 5, deletedPosts: 20 } });
		const result = await nukeUser(42);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/users/42/nuke");
		expect(result.nuked).toBe(true);
	});

	it("batchSetStatus calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 3 } });
		const result = await batchSetStatus([1, 2, 3], -1);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/users/batch-status", {
			ids: [1, 2, 3],
			status: -1,
		});
		expect(result.affected).toBe(3);
	});

	it("batchSetRole calls post", async () => {
		mockPost.mockResolvedValue({ data: { affected: 2 } });
		const result = await batchSetRole([1, 2], 1);
		expect(mockPost).toHaveBeenCalledWith("/api/admin/users/batch-role", { ids: [1, 2], role: 1 });
		expect(result.affected).toBe(2);
	});

	it("fetchUsersByIds returns empty for empty ids", async () => {
		const result = await fetchUsersByIds([]);
		expect(result).toEqual([]);
		expect(mockGet).not.toHaveBeenCalled();
	});

	it("fetchUsersByIds calls get with joined ids", async () => {
		mockGet.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
		const result = await fetchUsersByIds([1, 2]);
		expect(mockGet).toHaveBeenCalledWith("/api/admin/users/batch", { ids: "1,2" });
		expect(result).toHaveLength(2);
	});
});
