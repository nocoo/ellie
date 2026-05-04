import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock forum-cache to spy on invalidateForumVolatile
vi.mock("../../../src/lib/forum-cache", () => ({
	invalidateForumVolatile: vi.fn(async () => {}),
	invalidateForumCacheAll: vi.fn(async () => {}),
	invalidateForumTree: vi.fn(async () => {}),
	isForumCacheEnabled: vi.fn(() => true),
}));

// Mock recalcMetadata (called before invalidation)
vi.mock("../../../src/lib/recalcMetadata", () => ({
	recalcForumMetadata: vi.fn(async () => {}),
	recalcThreadMetadata: vi.fn(async () => {}),
}));

// Mock userCounters
vi.mock("../../../src/lib/userCounters", () => ({
	decrementUserPosts: vi.fn(async () => {}),
	decrementUserThreads: vi.fn(async () => {}),
	batchDecrementUserPosts: vi.fn(async () => {}),
}));

import { deleteMyPost, deleteMyThread } from "../../../src/handlers/user-content";
import { invalidateForumVolatile } from "../../../src/lib/forum-cache";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";

const mockInvalidateVolatile = invalidateForumVolatile as ReturnType<typeof vi.fn>;

describe("volatile cache invalidation — user content destructive ops", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invalidates volatile cache after user deletes own post", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 5,
					thread_id: 1,
					forum_id: 1,
					author_id: 10,
					is_first: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const request = new Request("https://api.example.com/api/v1/me/posts/5", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		const response = await deleteMyPost(request, env);

		expect(response.status).toBe(200);
		expect(mockInvalidateVolatile).toHaveBeenCalledTimes(1);
	});

	it("invalidates volatile cache after user deletes own thread", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT id, forum_id, author_id, replies FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 2,
				},
			},
			allResults: {
				"SELECT author_id FROM posts WHERE thread_id": [
					{ author_id: 10 },
					{ author_id: 10 },
					{ author_id: 20 },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const request = new Request("https://api.example.com/api/v1/me/threads/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});

		const response = await deleteMyThread(request, env);

		expect(response.status).toBe(200);
		expect(mockInvalidateVolatile).toHaveBeenCalledTimes(1);
	});

	it("does NOT invalidate volatile cache on auth failure", async () => {
		const env = makeEnv();
		const request = new Request("https://api.example.com/api/v1/me/posts/1", {
			method: "DELETE",
		});

		const response = await deleteMyPost(request, env);

		expect(response.status).toBe(401);
		expect(mockInvalidateVolatile).not.toHaveBeenCalled();
	});
});
