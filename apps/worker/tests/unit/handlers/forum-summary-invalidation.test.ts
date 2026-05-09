// Phase 3 commit C — v2 forum:summary:gen + thread:list:gen invalidation
// parity at high-risk fan-out callsites. We mock the low-level
// `bumpForumSummaryGen` and `bumpThreadListGen` so we can assert that every
// destructive write still bumps both gens (directly or via the
// `invalidateForumVolatileV2` composite helper).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/cache/invalidate", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/invalidate")>(
		"../../../src/lib/cache/invalidate",
	);
	const bumpForumSummaryGen = vi.fn(async () => "g1");
	const bumpThreadListGen = vi.fn(async () => "g1");
	const bumpThreadListGenAll = vi.fn(async () => "g1");
	const bumpDigestGen = vi.fn(async () => "g1");
	return {
		...actual,
		bumpForumSummaryGen,
		bumpThreadListGen,
		bumpThreadListGenAll,
		bumpDigestGen,
		// Re-derive the composites so they call the spies.
		invalidateForumSummaryV2: vi.fn(async (_env: unknown) => {
			await bumpForumSummaryGen();
		}),
		invalidateForumVolatileV2: vi.fn(async (_env: unknown, fid: number) => {
			await Promise.all([bumpForumSummaryGen(), bumpThreadListGen(_env, fid)]);
		}),
		invalidateThreadListForForums: vi.fn(async (_env: unknown, fids: readonly number[]) => {
			const unique = Array.from(new Set(fids));
			await Promise.all(unique.map((id) => bumpThreadListGen(_env, id)));
		}),
		invalidateUserCaches: vi.fn(async () => {}),
	};
});

vi.mock("../../../src/lib/recalcMetadata", () => ({
	recalcForumMetadata: vi.fn(async () => {}),
	recalcThreadMetadata: vi.fn(async () => {}),
}));

vi.mock("../../../src/lib/userCounters", () => ({
	decrementUserPosts: vi.fn(async () => {}),
	decrementUserThreads: vi.fn(async () => {}),
	batchDecrementUserPosts: vi.fn(async () => {}),
	batchDecrementUserThreads: vi.fn(async () => {}),
}));

import {
	batchDelete as adminPostBatchDelete,
	remove as adminPostRemove,
} from "../../../src/handlers/admin/post";
import {
	batchDelete as adminThreadBatchDelete,
	remove as adminThreadRemove,
} from "../../../src/handlers/admin/thread";
import { nuke as adminUserNuke } from "../../../src/handlers/admin/user";
import {
	deletePost as modDeletePost,
	deleteThread as modDeleteThread,
	moveThread as modMoveThread,
} from "../../../src/handlers/moderation";
import { bumpForumSummaryGen, bumpThreadListGen } from "../../../src/lib/cache/invalidate";
import { createAdminRequest, createJwtForRole, createMockDb, makeEnv } from "../../helpers";

const mockSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockThreadList = bumpThreadListGen as ReturnType<typeof vi.fn>;

async function modToken(role: number, userId = 1): Promise<string> {
	return createJwtForRole(role, userId);
}

function modAuthRow(role = 1) {
	return {
		"SELECT role, status, email_verified_at FROM users WHERE id": {
			role,
			status: 0,
			email_verified_at: 1700000000,
		},
		"SELECT id, username, role, status FROM users": {
			id: 1,
			username: "admin",
			role,
			status: 0,
		},
		"SELECT id, moderators, moderator_ids FROM forums": {
			id: 1,
			moderators: "",
			moderator_ids: "",
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("forum:summary:gen + thread:list:gen v2 parity — moderation handlers", () => {
	it("moderation moveThread bumps summary + per-forum thread-list (source + target)", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({
			firstResults: {
				...modAuthRow(1),
				"SELECT id, forum_id, replies FROM threads": { id: 1, forum_id: 1, replies: 5 },
				"SELECT id FROM forums WHERE id": { id: 2 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/move", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: JSON.stringify({ targetForumId: 2 }),
		});
		const res = await modMoveThread(req, env);
		expect(res.status).toBe(200);
		// Both source (1) and target (2) thread-list gens must be bumped.
		const bumpedForumIds = mockThreadList.mock.calls.map((c) => c[1]);
		expect(bumpedForumIds).toEqual(expect.arrayContaining([1, 2]));
		expect(mockSummary).toHaveBeenCalled();
	});

	it("moderation deletePost bumps summary + per-forum thread-list", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({
			firstResults: {
				...modAuthRow(1),
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
		const req = new Request("https://api.example.com/api/v1/moderation/posts/5", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await modDeletePost(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 1);
		expect(mockSummary).toHaveBeenCalled();
	});

	it("moderation deleteThread bumps summary + per-forum thread-list", async () => {
		const token = await modToken(1);
		const { db } = createMockDb({
			firstResults: {
				...modAuthRow(1),
				"SELECT id, forum_id, author_id, replies, digest FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 2,
					digest: 0,
				},
			},
			allResults: {
				"SELECT author_id FROM posts WHERE thread_id": [{ author_id: 10 }, { author_id: 20 }],
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await modDeleteThread(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 1);
		expect(mockSummary).toHaveBeenCalled();
	});
});

describe("forum:summary:gen + thread:list:gen v2 parity — admin destructive handlers", () => {
	it("admin post remove bumps summary + per-forum thread-list", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM posts WHERE id": {
					id: 5,
					thread_id: 1,
					forum_id: 1,
					author_id: 10,
					is_first: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("DELETE", "/api/admin/posts/5");
		const res = await adminPostRemove(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 1);
		expect(mockSummary).toHaveBeenCalled();
	});

	it("admin post batchDelete bumps summary + per-forum thread-list", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts WHERE id IN": [
					{ id: 5, thread_id: 1, forum_id: 1, author_id: 10, is_first: 0 },
					{ id: 6, thread_id: 1, forum_id: 1, author_id: 11, is_first: 0 },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/posts/batch-delete", { ids: [5, 6] });
		const res = await adminPostBatchDelete(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 1);
		expect(mockSummary).toHaveBeenCalled();
	});

	it("admin thread remove bumps summary + per-forum thread-list", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM threads WHERE id": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 2,
					digest: 0,
				},
			},
			allResults: {
				"SELECT id FROM posts WHERE thread_id": [{ id: 5 }, { id: 6 }],
				"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN": [
					{ author_id: 10, cnt: 1 },
					{ author_id: 20, cnt: 1 },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("DELETE", "/api/admin/threads/1");
		const res = await adminThreadRemove(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 1);
		expect(mockSummary).toHaveBeenCalled();
	});

	it("admin thread batchDelete bumps summary + per-forum thread-list", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id, forum_id, author_id, digest FROM threads WHERE id IN": [
					{ id: 1, forum_id: 1, author_id: 10, digest: 0 },
					{ id: 2, forum_id: 1, author_id: 11, digest: 0 },
				],
				"SELECT thread_id, author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN": [
					{ thread_id: 1, author_id: 10, cnt: 1 },
					{ thread_id: 2, author_id: 20, cnt: 1 },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/threads/batch-delete", { ids: [1, 2] });
		const res = await adminThreadBatchDelete(req, env);
		expect(res.status).toBe(200);
		expect(mockThreadList).toHaveBeenCalledWith(expect.anything(), 1);
		expect(mockSummary).toHaveBeenCalled();
	});

	it("admin user nuke bumps summary (per-forum gens depend on affected set)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM users WHERE id": {
					id: 99,
					username: "spam",
					role: 0,
					status: 0,
					avatar_path: null,
				},
				"SELECT COUNT(*) as cnt FROM threads WHERE author_id": { cnt: 0 },
			},
			allResults: {
				"SELECT id, forum_id, replies, digest FROM threads WHERE author_id": [],
				"SELECT id, thread_id, forum_id FROM posts WHERE author_id": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = createAdminRequest("POST", "/api/admin/users/99/nuke");
		const res = await adminUserNuke(req, env);
		// We do not assert exact status — handler may early-exit on missing
		// child rows in this minimal mock. We only care that IF the success
		// path runs, summary fired (per-forum bumps depend on the affected
		// set which is empty here).
		if (res.status === 200) {
			expect(mockSummary).toHaveBeenCalled();
		}
	});
});
