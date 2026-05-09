// Phase 1 commit 2b — admin user batch endpoints invalidate user caches
// (legacy `user:mini:<id>` AND v2 mini + both viewer-bucket public variants)
// for every affected id. See docs/19 §6 rows
//   "admin user batch-status / batch-role / batch-recalc-counters /
//    single recalc-counters".
// Behavior of the underlying handlers is covered by their existing tests;
// this file only locks the cache fan-out so a future regression that drops
// a hook is caught.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/forum-cache", () => ({
	invalidateForumVolatile: vi.fn(async () => {}),
	invalidateForumCacheAll: vi.fn(async () => {}),
	invalidateForumTree: vi.fn(async () => {}),
	isForumCacheEnabled: vi.fn(() => true),
}));

vi.mock("../../../src/lib/cache/invalidate", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/invalidate")>(
		"../../../src/lib/cache/invalidate",
	);
	return {
		...actual,
		invalidateUserCaches: vi.fn(async () => {}),
	};
});

vi.mock("../../../src/lib/user-cache", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/user-cache")>(
		"../../../src/lib/user-cache",
	);
	return {
		...actual,
		invalidateUserCache: vi.fn(async () => {}),
	};
});

import {
	batchRecalcCounters,
	batchRole,
	batchStatus,
	recalcCounters,
	update,
} from "../../../src/handlers/admin/user";
import { invalidateUserCaches } from "../../../src/lib/cache/invalidate";
import { invalidateUserCache } from "../../../src/lib/user-cache";
import { createAdminRequest, createMockDb, makeD1UserRow, makeEnv } from "../../helpers";

const mockInvUser = invalidateUserCache as ReturnType<typeof vi.fn>;
const mockInvUserV2 = invalidateUserCaches as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Phase 1 commit 2b — admin user batch invalidation", () => {
	it("batchStatus invalidates per-id user caches (legacy + v2)", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id FROM users WHERE id IN": [], // tombstone check returns empty
			},
			runResults: {
				"UPDATE users SET status": { success: true, meta: { changes: 2 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/users/batch-status", {
			ids: [10, 11],
			status: -1,
		});
		const res = await batchStatus(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledTimes(2);
		expect(mockInvUser).toHaveBeenCalledWith(env, 10);
		expect(mockInvUser).toHaveBeenCalledWith(env, 11);
		expect(mockInvUserV2).toHaveBeenCalledTimes(2);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 10);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 11);
	});

	it("batchRole invalidates per-id user caches (legacy + v2)", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id FROM users WHERE id IN": [],
			},
			runResults: {
				"UPDATE users SET role": { success: true, meta: { changes: 2 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/users/batch-role", {
			ids: [20, 21],
			role: 3,
		});
		const res = await batchRole(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledTimes(2);
		expect(mockInvUserV2).toHaveBeenCalledTimes(2);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 20);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 21);
	});

	it("recalcCounters invalidates the single user's caches (legacy + v2)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, status FROM users WHERE id": { id: 30, status: 0 },
				"SELECT COUNT(*) as cnt FROM threads WHERE author_id": { cnt: 5 },
				"SELECT COUNT(*) as cnt FROM posts WHERE author_id": { cnt: 17 },
				"SELECT COUNT(*) as cnt FROM threads WHERE author_id = ? AND digest > 0": { cnt: 1 },
			},
			runResults: {
				"UPDATE users SET threads": { success: true, meta: { changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/users/30/recalc-counters");
		const res = await recalcCounters(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledTimes(1);
		expect(mockInvUser).toHaveBeenCalledWith(env, 30);
		expect(mockInvUserV2).toHaveBeenCalledTimes(1);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 30);
	});

	it("batchRecalcCounters invalidates per-id caches (legacy + v2)", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id FROM users WHERE status >= 0": [{ id: 40 }, { id: 41 }],
				"SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN": [],
				"SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN": [],
				"SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (?,?) AND digest > 0":
					[],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/users/batch-recalc-counters");
		const res = await batchRecalcCounters(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledTimes(2);
		expect(mockInvUser).toHaveBeenCalledWith(env, 40);
		expect(mockInvUser).toHaveBeenCalledWith(env, 41);
		expect(mockInvUserV2).toHaveBeenCalledTimes(2);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 40);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 41);
	});
});

describe("Phase 1 commit 2c — admin user PATCH afterUpdate invalidation", () => {
	// docs/19 §6 row "PATCH /api/admin/users/:id":
	// afterUpdate must drop both legacy `user:mini:<id>` and v2 mini +
	// public variants whenever any PublicUser-payload field or
	// visibility-affecting field changes. `email` is intentionally NOT
	// in the trigger set because it is not part of PublicUser.

	function patch(id: number, body: Record<string, unknown>) {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM users WHERE id": makeD1UserRow({ id }),
				"SELECT id FROM users WHERE username": null,
				"SELECT id, username": makeD1UserRow({ id, ...body }),
			},
		});
		return { db, req: createAdminRequest("PATCH", `/api/admin/users/${id}`, body) };
	}

	it("status update invalidates legacy + v2", async () => {
		const { db, req } = patch(50, { status: -1 });
		const env = makeEnv({ DB: db });
		const res = await update(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledWith(env, 50);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 50);
	});

	it("credits update invalidates legacy + v2", async () => {
		const { db, req } = patch(51, { credits: 999 });
		const env = makeEnv({ DB: db });
		const res = await update(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledWith(env, 51);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 51);
	});

	it("coins update invalidates legacy + v2", async () => {
		const { db, req } = patch(52, { coins: 7 });
		const env = makeEnv({ DB: db });
		const res = await update(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledWith(env, 52);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 52);
	});

	it("email-only update does NOT invalidate (email not in PublicUser)", async () => {
		const { db, req } = patch(53, { email: "new@example.com" });
		const env = makeEnv({ DB: db });
		const res = await update(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).not.toHaveBeenCalled();
		expect(mockInvUserV2).not.toHaveBeenCalled();
	});
});
