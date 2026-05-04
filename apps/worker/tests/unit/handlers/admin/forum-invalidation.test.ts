import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock forum-cache to spy on invalidateForumCacheAll
vi.mock("../../../../src/lib/forum-cache", () => ({
	invalidateForumCacheAll: vi.fn(async () => {}),
	invalidateForumTree: vi.fn(async () => {}),
	invalidateForumVolatile: vi.fn(async () => {}),
	isForumCacheEnabled: vi.fn(() => true),
}));

// Mock recalcMetadata (used by merge handler)
vi.mock("../../../../src/lib/recalcMetadata", () => ({
	recalcForumMetadata: vi.fn(async () => {}),
}));

import { create, merge, remove, reorder, update } from "../../../../src/handlers/admin/forum";
import { invalidateForumCacheAll } from "../../../../src/lib/forum-cache";
import { createMockDb, makeD1ForumRow, makeEnv } from "../../../helpers";

const mockInvalidate = invalidateForumCacheAll as ReturnType<typeof vi.fn>;

describe("admin forum — KV cache invalidation", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("invalidates after successful create", async () => {
		const { db } = createMockDb({
			runResults: { "INSERT INTO forums": { success: true, meta: { last_row_id: 1 } } },
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 1, name: "New" }),
			},
		});

		const res = await create(
			new Request("https://api.example.com/api/admin/forums", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "New" }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(201);
		expect(mockInvalidate).toHaveBeenCalledTimes(1);
	});

	it("invalidates after successful update", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42, name: "Updated" }),
			},
		});

		const res = await update(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated" }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockInvalidate).toHaveBeenCalledTimes(1);
	});

	it("invalidates after successful delete", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				"SELECT COUNT(*) as cnt FROM threads": { cnt: 0 },
			},
		});

		const res = await remove(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "DELETE",
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockInvalidate).toHaveBeenCalledTimes(1);
	});

	it("does NOT invalidate when delete is rejected (has threads)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				"SELECT COUNT(*) as cnt FROM threads": { cnt: 5 },
			},
		});

		const res = await remove(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "DELETE",
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(409);
		expect(mockInvalidate).not.toHaveBeenCalled();
	});

	it("invalidates after successful merge", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 10 }),
				"SELECT id FROM forums WHERE id": { id: 20 },
				"SELECT COUNT(*) as cnt FROM threads": { cnt: 2 },
				"SELECT COUNT(*) as cnt FROM posts": { cnt: 10 },
			},
		});

		const res = await merge(
			new Request("https://api.example.com/api/admin/forums/10/merge", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetForumId: 20 }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockInvalidate).toHaveBeenCalledTimes(1);
	});

	it("invalidates after successful reorder", async () => {
		const { db } = createMockDb();

		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/reorder", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					orders: [
						{ id: 1, displayOrder: 0 },
						{ id: 2, displayOrder: 1 },
					],
				}),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockInvalidate).toHaveBeenCalledTimes(1);
	});

	it("does NOT invalidate on validation error (reorder)", async () => {
		const { db } = createMockDb();

		const res = await reorder(
			new Request("https://api.example.com/api/admin/forums/reorder", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ orders: [] }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(400);
		expect(mockInvalidate).not.toHaveBeenCalled();
	});
});
