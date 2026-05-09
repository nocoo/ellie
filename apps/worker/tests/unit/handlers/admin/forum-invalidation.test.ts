import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock recalcMetadata (used by merge handler)
vi.mock("../../../../src/lib/recalcMetadata", () => ({
	recalcForumMetadata: vi.fn(async () => {}),
}));

// Spy on the v2 invalidation helpers so we can assert per-mutation fan-out.
// Use importOriginal so non-mocked exports (e.g. `affectsForumDigest`)
// remain real implementations.
vi.mock("../../../../src/lib/cache/invalidate", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../../../src/lib/cache/invalidate")>();
	return {
		...actual,
		invalidateForumStructureV2: vi.fn(async () => {}),
		invalidateForumReorderV2: vi.fn(async () => {}),
		invalidateForumUpdateV2: vi.fn(async () => {}),
		invalidateForumSummaryV2: vi.fn(async () => {}),
	};
});

import { create, merge, remove, reorder, update } from "../../../../src/handlers/admin/forum";
import {
	invalidateForumReorderV2,
	invalidateForumStructureV2,
	invalidateForumUpdateV2,
} from "../../../../src/lib/cache/invalidate";
import { createMockDb, makeD1ForumRow, makeEnv } from "../../../helpers";

const mockStructureV2 = invalidateForumStructureV2 as ReturnType<typeof vi.fn>;
const mockReorderV2 = invalidateForumReorderV2 as ReturnType<typeof vi.fn>;
const mockUpdateV2 = invalidateForumUpdateV2 as ReturnType<typeof vi.fn>;

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

		expect(mockStructureV2).toHaveBeenCalledTimes(1);
	});

	it("invalidates after successful update (digest-affecting field bumps digest)", async () => {
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

		expect(mockUpdateV2).toHaveBeenCalledTimes(1);
		expect(mockUpdateV2).toHaveBeenCalledWith(expect.anything(), { affectsDigest: true });
	});

	it("update with non-digest field (description) does NOT bump digest", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42, description: "old" }),
			},
		});

		const res = await update(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ description: "new" }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockUpdateV2).toHaveBeenCalledWith(expect.anything(), { affectsDigest: false });
	});

	it("update with displayOrder only does NOT bump digest", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
			},
		});

		const res = await update(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ displayOrder: 7 }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockUpdateV2).toHaveBeenCalledWith(expect.anything(), { affectsDigest: false });
	});

	it("update with visibility bumps digest", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
			},
		});

		const res = await update(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ visibility: "members" }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockUpdateV2).toHaveBeenCalledWith(expect.anything(), { affectsDigest: true });
	});

	it("update with parentId bumps digest (parent_id column)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
			},
		});

		const res = await update(
			new Request("https://api.example.com/api/admin/forums/42", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ parentId: 2 }),
			}),
			adminEnv(db),
		);

		expect(res.status).toBe(200);
		expect(mockUpdateV2).toHaveBeenCalledWith(expect.anything(), { affectsDigest: true });
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

		expect(mockStructureV2).toHaveBeenCalledTimes(1);
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

		expect(mockStructureV2).not.toHaveBeenCalled();
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

		expect(mockStructureV2).toHaveBeenCalledTimes(1);
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

		expect(mockReorderV2).toHaveBeenCalledTimes(1);
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

		expect(mockReorderV2).not.toHaveBeenCalled();
	});
});
