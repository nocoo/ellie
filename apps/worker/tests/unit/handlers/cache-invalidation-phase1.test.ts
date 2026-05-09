// Asserts the cache invalidation hooks added in Phase 1 commit 2 land on
// the right write paths (docs/19 §6). Behavior of the underlying handlers is
// covered by their existing per-handler tests; this file only verifies the
// invalidation fan-out so a future regression that drops a hook is caught.

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
		invalidateForumVolatileV2: vi.fn(async () => {}),
		bumpThreadMetaGen: vi.fn(async () => "g"),
		bumpPostListGen: vi.fn(async () => "g"),
		bumpForumSummaryGen: vi.fn(async () => "g"),
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

vi.mock("../../../src/lib/postingPermission", () => ({
	checkPostingPermission: vi.fn(async () => ({ allowed: true })),
}));

vi.mock("../../../src/lib/censor", () => ({
	applyCensorFilter: vi.fn(async (content: string) => ({ banned: false, content })),
}));

import { recalcForums, recalcThreads, recalcUsers } from "../../../src/handlers/admin/statistics";
import { create as createPost } from "../../../src/handlers/post";
import { create as createThread } from "../../../src/handlers/thread";
import {
	bumpForumSummaryGen,
	bumpPostListGen,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
	invalidateUserCaches,
} from "../../../src/lib/cache/invalidate";
import { invalidateForumVolatile } from "../../../src/lib/forum-cache";
import { invalidateUserCache } from "../../../src/lib/user-cache";
import { createAdminRequest, createJwtForRole, createMockDb, makeEnv } from "../../helpers";

const mockInvVol = invalidateForumVolatile as ReturnType<typeof vi.fn>;
const mockInvVolV2 = invalidateForumVolatileV2 as ReturnType<typeof vi.fn>;
const mockBumpSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockBumpThreadMeta = bumpThreadMetaGen as ReturnType<typeof vi.fn>;
const mockBumpPostList = bumpPostListGen as ReturnType<typeof vi.fn>;
const mockInvUser = invalidateUserCache as ReturnType<typeof vi.fn>;
const mockInvUserV2 = invalidateUserCaches as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("Phase 1 commit 2 — thread/post create invalidation", () => {
	it("POST /api/v1/threads invalidates legacy volatile + v2 forum gens", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT id, status, visibility FROM forums": {
					id: 1,
					status: 1,
					visibility: "public",
				},
				"SELECT username FROM users": { username: "alice" },
				"SELECT * FROM threads WHERE id": {
					id: 99,
					forum_id: 1,
					author_id: 10,
					author_name: "alice",
					subject: "hi",
					created_at: 1,
					last_post_at: 1,
					last_poster: "alice",
					last_poster_id: 10,
					replies: 0,
					views: 0,
					closed: 0,
					sticky: 0,
					digest: 0,
					special: 0,
					highlight: 0,
					recommends: 0,
					type_name: "",
				},
			},
			runResults: {
				"INSERT INTO threads": { success: true, meta: { last_row_id: 99, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/threads", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ forumId: 1, subject: "hi", content: "body" }),
		});

		const res = await createThread(req, env);
		expect(res.status).toBe(201);
		expect(mockInvVol).toHaveBeenCalledTimes(1);
		expect(mockInvVolV2).toHaveBeenCalledWith(env, 1);
	});

	it("POST /api/v1/posts invalidates legacy volatile + v2 forum/thread/post gens", async () => {
		const token = await createJwtForRole(0, 10);
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				"SELECT t.id, t.forum_id, t.closed, f.status, f.visibility": {
					id: 1,
					forum_id: 7,
					closed: 0,
					status: 1,
					visibility: "public",
				},
				"SELECT MAX(position)": { maxPos: 3 },
				"SELECT username FROM users": { username: "alice" },
				"SELECT * FROM posts WHERE id": {
					id: 200,
					thread_id: 1,
					forum_id: 7,
					author_id: 10,
					author_name: "alice",
					content: "x",
					created_at: 1,
					is_first: 0,
					position: 4,
				},
			},
			runResults: {
				"INSERT INTO posts": { success: true, meta: { last_row_id: 200, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/posts", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ threadId: 1, content: "reply" }),
		});

		const res = await createPost(req, env);
		expect(res.status).toBe(201);
		expect(mockInvVol).toHaveBeenCalledTimes(1);
		expect(mockInvVolV2).toHaveBeenCalledWith(env, 7);
		expect(mockBumpThreadMeta).toHaveBeenCalledWith(env, 1);
		expect(mockBumpPostList).toHaveBeenCalledWith(env, 1);
	});
});

describe("Phase 1 commit 2 — admin statistics invalidation", () => {
	it("recalcForums drops volatile only (not tree) and bumps forum:summary:gen", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id FROM forums": [{ id: 1 }, { id: 2 }],
				"SELECT forum_id, COUNT(*) as cnt FROM threads": [],
				"SELECT forum_id, COUNT(*) as cnt FROM posts": [],
				"SELECT t1.forum_id, t1.id, t1.subject": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/statistics/recalc-forums");
		const res = await recalcForums(req, env);
		expect(res.status).toBe(200);
		expect(mockInvVol).toHaveBeenCalledTimes(1);
		expect(mockBumpSummary).toHaveBeenCalledTimes(1);
	});

	it("recalcThreads drops volatile and bumps forum:summary:gen", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id, created_at, author_name, author_id FROM threads": [
					{ id: 1, created_at: 1, author_name: "a", author_id: 10 },
				],
				"SELECT thread_id, COUNT(*)": [],
				"SELECT p1.thread_id": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/statistics/recalc-threads");
		const res = await recalcThreads(req, env);
		expect(res.status).toBe(200);
		expect(mockInvVol).toHaveBeenCalledTimes(1);
		expect(mockBumpSummary).toHaveBeenCalledTimes(1);
	});

	it("recalcUsers invalidates per-id user caches (legacy + v2)", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id FROM users WHERE status >= 0": [{ id: 10 }, { id: 11 }],
				"SELECT author_id, COUNT(*) as cnt FROM threads": [],
				"SELECT author_id, COUNT(*) as cnt FROM posts": [],
				"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest > 0": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/statistics/recalc-users");
		const res = await recalcUsers(req, env);
		expect(res.status).toBe(200);
		expect(mockInvUser).toHaveBeenCalledTimes(2);
		expect(mockInvUser).toHaveBeenCalledWith(env, 10);
		expect(mockInvUser).toHaveBeenCalledWith(env, 11);
		expect(mockInvUserV2).toHaveBeenCalledTimes(2);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 10);
		expect(mockInvUserV2).toHaveBeenCalledWith(env, 11);
	});
});
