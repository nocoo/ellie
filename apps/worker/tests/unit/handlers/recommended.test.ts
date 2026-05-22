// Tests for the "推荐主题" handlers (migration 0045):
//
//   GET    /api/v1/forums/:id/recommended-threads      public list (capped 6, thread_id DESC)
//   POST   /api/v1/moderation/threads/:id/recommend    moderator add (INSERT OR IGNORE, idempotent)
//   DELETE /api/v1/moderation/threads/:id/recommend    moderator remove (idempotent 200)
//
// Cache invalidation freeze (reviewer msg d9c01f23):
//   addRecommend / removeRecommend MUST bump only `thread:meta:gen:<id>`
//   and MUST NOT bump `forum:summary:gen` or `thread:list:gen:*` — the
//   recommend list endpoint is uncached (independent D1 query) and the
//   forum summary / page-1 thread-list payloads do not change when the
//   recommended flag flips.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/cache/invalidate", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/cache/invalidate")>(
		"../../../src/lib/cache/invalidate",
	);
	return {
		...actual,
		bumpThreadMetaGen: vi.fn(async () => "g"),
		bumpForumSummaryGen: vi.fn(async () => "g"),
		invalidateForumVolatileV2: vi.fn(async () => {}),
	};
});

import {
	addRecommend,
	listRecommendedThreads,
	removeRecommend,
} from "../../../src/handlers/recommended";
import {
	bumpForumSummaryGen,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
} from "../../../src/lib/cache/invalidate";
import { createJwt } from "../../../src/lib/jwt";
import { TEST_JWT_SECRET, createMockDb, makeEnv } from "../../helpers";

const mockBumpThreadMeta = bumpThreadMetaGen as ReturnType<typeof vi.fn>;
const mockBumpSummary = bumpForumSummaryGen as ReturnType<typeof vi.fn>;
const mockInvVolV2 = invalidateForumVolatileV2 as ReturnType<typeof vi.fn>;

async function makeToken(role: number, userId = 1): Promise<string> {
	return createJwt({ userId, role, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_JWT_SECRET);
}

function modRequest(method: "POST" | "DELETE", threadId: number, token: string | null): Request {
	return new Request(`https://api.example.com/api/v1/moderation/threads/${threadId}/recommend`, {
		method,
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
}

function listRequest(forumId: number, token?: string): Request {
	return new Request(`https://api.example.com/api/v1/forums/${forumId}/recommended-threads`, {
		method: "GET",
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	});
}

function mockAuthRow(role = 1, status = 0, email_verified_at = 1700000000) {
	return {
		"SELECT role, status, email_verified_at FROM users WHERE id": {
			role,
			status,
			email_verified_at,
		},
	};
}

function mockThreadForPerm(threadId = 100, forumId = 1, authorId = 7) {
	return {
		"SELECT id, forum_id, author_id FROM threads WHERE id": {
			id: threadId,
			forum_id: forumId,
			author_id: authorId,
		},
	};
}

function mockUserForPerm(userId = 1, role = 1, username = "admin") {
	return {
		"SELECT id, username, role, status FROM users": {
			id: userId,
			username,
			role,
			status: 0,
		},
	};
}

function mockForumForPerm(forumId = 1, moderators = "") {
	return {
		"SELECT id, moderators, moderator_ids FROM forums": {
			id: forumId,
			moderators,
			moderator_ids: "",
		},
	};
}

function mockForumVis(status = 1, visibility: "public" | "members" | "staff" | "admin" = "public") {
	return {
		"SELECT status, visibility FROM forums WHERE id": { status, visibility },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ─── POST /api/v1/moderation/threads/:id/recommend ───────────────

describe("POST recommend — auth + RBAC", () => {
	it("401 without auth", async () => {
		const env = makeEnv();
		const res = await addRecommend(modRequest("POST", 100, null), env);
		expect(res.status).toBe(401);
	});

	it("403 FORBIDDEN_MOD_ONLY for regular user (role 0)", async () => {
		const token = await makeToken(0);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(0) } });
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("FORBIDDEN_MOD_ONLY");
	});

	it("403 USER_BANNED for banned mod", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(3, 1) } });
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(403);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("USER_BANNED");
	});

	it("403 for mod with unverified email", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(3, 0, 0) } });
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(403);
	});

	it("404 THREAD_NOT_FOUND when thread row missing", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(1) } });
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 999, token), env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("THREAD_NOT_FOUND");
	});

	it("200 for Admin on any forum", async () => {
		const token = await makeToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockThreadForPerm(100, 1),
				...mockUserForPerm(1, 1, "admin"),
				...mockForumForPerm(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			data: { forumId: number; threadId: number; recommended: boolean };
		};
		expect(data.data).toEqual({ forumId: 1, threadId: 100, recommended: true });
		// INSERT OR IGNORE issued with the canonical column order
		const insertCall = calls.find((c) =>
			c.sql.includes("INSERT OR IGNORE INTO forum_recommended_threads"),
		);
		expect(insertCall).toBeDefined();
		expect(insertCall?.params[0]).toBe(1); // forum_id
		expect(insertCall?.params[1]).toBe(100); // thread_id
		expect(insertCall?.params[3]).toBe(1); // recommended_by = user id
	});

	it("200 for SuperMod on any forum", async () => {
		const token = await makeToken(2);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(2),
				...mockThreadForPerm(100, 5),
				...mockUserForPerm(1, 2, "supermod"),
				...mockForumForPerm(5, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(200);
	});

	it("200 for Mod in forum.moderators", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockThreadForPerm(100, 4),
				...mockUserForPerm(2, 3, "moduser"),
				...mockForumForPerm(4, "moduser,other"),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(200);
	});

	it("403 for Mod NOT in forum.moderators", async () => {
		const token = await makeToken(3, 2);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockThreadForPerm(100, 4),
				...mockUserForPerm(2, 3, "moduser"),
				...mockForumForPerm(4, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(403);
		// No write side-effects: no INSERT statement should have been built.
		const insertCall = calls.find((c) =>
			c.sql.includes("INSERT OR IGNORE INTO forum_recommended_threads"),
		);
		expect(insertCall).toBeUndefined();
	});

	it("idempotent: repeat call still 200 (INSERT OR IGNORE semantics)", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockThreadForPerm(100, 1),
				...mockUserForPerm(1, 1, "admin"),
				...mockForumForPerm(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const r1 = await addRecommend(modRequest("POST", 100, token), env);
		const r2 = await addRecommend(modRequest("POST", 100, token), env);
		expect(r1.status).toBe(200);
		expect(r2.status).toBe(200);
	});
});

// ─── DELETE /api/v1/moderation/threads/:id/recommend ─────────────

describe("DELETE recommend — auth + RBAC + idempotence", () => {
	it("401 without auth", async () => {
		const env = makeEnv();
		const res = await removeRecommend(modRequest("DELETE", 100, null), env);
		expect(res.status).toBe(401);
	});

	it("403 FORBIDDEN_MOD_ONLY for regular user", async () => {
		const token = await makeToken(0);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(0) } });
		const env = makeEnv({ DB: db });
		const res = await removeRecommend(modRequest("DELETE", 100, token), env);
		expect(res.status).toBe(403);
	});

	it("404 THREAD_NOT_FOUND when thread row missing", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthRow(1) } });
		const env = makeEnv({ DB: db });
		const res = await removeRecommend(modRequest("DELETE", 999, token), env);
		expect(res.status).toBe(404);
	});

	it("403 for Mod NOT in forum.moderators (no DELETE issued)", async () => {
		const token = await makeToken(3, 2);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockThreadForPerm(100, 4),
				...mockUserForPerm(2, 3, "moduser"),
				...mockForumForPerm(4, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await removeRecommend(modRequest("DELETE", 100, token), env);
		expect(res.status).toBe(403);
		const deleteCall = calls.find((c) => c.sql.includes("DELETE FROM forum_recommended_threads"));
		expect(deleteCall).toBeUndefined();
	});

	it("200 returns recommended:false on a present row", async () => {
		const token = await makeToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockThreadForPerm(100, 1),
				...mockUserForPerm(1, 1, "admin"),
				...mockForumForPerm(1, ""),
			},
			runResults: {
				"DELETE FROM forum_recommended_threads": {
					success: true,
					meta: { changes: 1, last_row_id: 0 },
				},
			},
		});
		const env = makeEnv({ DB: db });
		const res = await removeRecommend(modRequest("DELETE", 100, token), env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			data: { forumId: number; threadId: number; recommended: boolean };
		};
		expect(data.data).toEqual({ forumId: 1, threadId: 100, recommended: false });
		const deleteCall = calls.find((c) => c.sql.includes("DELETE FROM forum_recommended_threads"));
		expect(deleteCall).toBeDefined();
		expect(deleteCall?.params[0]).toBe(1); // forum_id
		expect(deleteCall?.params[1]).toBe(100); // thread_id
	});

	it("idempotent 200 when row is already gone (changes=0)", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockThreadForPerm(100, 1),
				...mockUserForPerm(1, 1, "admin"),
				...mockForumForPerm(1, ""),
			},
			runResults: {
				"DELETE FROM forum_recommended_threads": {
					success: true,
					meta: { changes: 0, last_row_id: 0 },
				},
			},
		});
		const env = makeEnv({ DB: db });
		const res = await removeRecommend(modRequest("DELETE", 100, token), env);
		expect(res.status).toBe(200);
	});
});

// ─── Cache-invalidation freeze (reviewer msg d9c01f23) ──────────

describe("recommend toggle invalidation — ONLY thread:meta:gen", () => {
	it("POST bumps thread:meta:gen exactly once, never forum summary / volatile", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockThreadForPerm(100, 1),
				...mockUserForPerm(1, 1, "admin"),
				...mockForumForPerm(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(200);
		expect(mockBumpThreadMeta).toHaveBeenCalledTimes(1);
		expect(mockBumpThreadMeta).toHaveBeenCalledWith(env, 100);
		// Reviewer pin: must NOT widen invalidation to forum-summary or
		// thread-list. These would needlessly invalidate page-1 thread
		// list payloads and forum tree/summary caches that did not change.
		expect(mockBumpSummary).not.toHaveBeenCalled();
		expect(mockInvVolV2).not.toHaveBeenCalled();
	});

	it("DELETE bumps thread:meta:gen exactly once, never forum summary / volatile", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(1),
				...mockThreadForPerm(100, 1),
				...mockUserForPerm(1, 1, "admin"),
				...mockForumForPerm(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await removeRecommend(modRequest("DELETE", 100, token), env);
		expect(res.status).toBe(200);
		expect(mockBumpThreadMeta).toHaveBeenCalledTimes(1);
		expect(mockBumpThreadMeta).toHaveBeenCalledWith(env, 100);
		expect(mockBumpSummary).not.toHaveBeenCalled();
		expect(mockInvVolV2).not.toHaveBeenCalled();
	});

	it("403 path does NOT bump any cache gen", async () => {
		const token = await makeToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthRow(3),
				...mockThreadForPerm(100, 4),
				...mockUserForPerm(2, 3, "moduser"),
				...mockForumForPerm(4, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const res = await addRecommend(modRequest("POST", 100, token), env);
		expect(res.status).toBe(403);
		expect(mockBumpThreadMeta).not.toHaveBeenCalled();
		expect(mockBumpSummary).not.toHaveBeenCalled();
		expect(mockInvVolV2).not.toHaveBeenCalled();
	});
});

// ─── GET /api/v1/forums/:id/recommended-threads ──────────────────

describe("GET recommended list — visibility gate + cap + ordering", () => {
	it("400 INVALID_REQUEST for non-numeric forum id", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/forums/abc/recommended-threads", {
			method: "GET",
		});
		const res = await listRecommendedThreads(req, env);
		expect(res.status).toBe(400);
	});

	it("404 FORUM_NOT_FOUND when forum row missing", async () => {
		const { db } = createMockDb({ firstResults: {} });
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(999), env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("FORUM_NOT_FOUND");
	});

	it("404 when forum is inactive (status != 1)", async () => {
		const { db } = createMockDb({
			firstResults: { ...mockForumVis(0, "public") },
		});
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(1), env);
		expect(res.status).toBe(404);
	});

	it("404 when forum visibility = members and caller is anonymous", async () => {
		const { db } = createMockDb({
			firstResults: { ...mockForumVis(1, "members") },
		});
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(1), env);
		expect(res.status).toBe(404);
	});

	it("404 when forum visibility = staff and caller has role User", async () => {
		const token = await makeToken(0, 10);
		const { db } = createMockDb({
			firstResults: { ...mockAuthRow(0), ...mockForumVis(1, "staff") },
		});
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(1, token), env);
		expect(res.status).toBe(404);
	});

	it("200 returns mapped threads ordered by thread_id DESC and capped to 6", async () => {
		// The handler delegates ORDER BY + LIMIT to D1; we verify the
		// returned payload mirrors the rows D1 hands back and that the
		// LIMIT bind value is exactly 6.
		const rows = [
			{
				id: 555,
				subject: "newest",
				author_id: 7,
				author_name: "alice",
				replies: 9,
				last_post_at: 1700001234,
				recommended_at: 1700000000,
			},
			{
				id: 320,
				subject: "older",
				author_id: 8,
				author_name: "bob",
				replies: 0,
				last_post_at: 1699999999,
				recommended_at: 1700000000,
			},
		];
		const { db, calls } = createMockDb({
			firstResults: { ...mockForumVis(1, "public") },
			allResults: {
				"FROM forum_recommended_threads r": rows,
			},
		});
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(1), env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			data: { forumId: number; threads: { id: number; subject: string }[] };
		};
		expect(data.data.forumId).toBe(1);
		expect(data.data.threads.map((t) => t.id)).toEqual([555, 320]);

		// Display cap = 6, baked into the LIMIT bind, not into the writer.
		const listCall = calls.find((c) => c.sql.includes("FROM forum_recommended_threads r"));
		expect(listCall).toBeDefined();
		expect(listCall?.params[0]).toBe(1); // forum_id bind
		expect(listCall?.params[1]).toBe(6); // LIMIT bind
		expect(listCall?.sql).toContain("ORDER BY r.thread_id DESC");
		// JOIN includes both the forum_id constraint (defends against
		// stale rows after moveThread races) and the THREAD_VISIBLE filter
		// (drops hidden / deleted thread rows).
		expect(listCall?.sql).toContain("t.forum_id = r.forum_id");
		expect(listCall?.sql).toContain("sticky >= 0");
	});

	it("200 empty list when no recommendations exist", async () => {
		const { db } = createMockDb({
			firstResults: { ...mockForumVis(1, "public") },
			allResults: { "FROM forum_recommended_threads r": [] },
		});
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(1), env);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { threads: unknown[] } };
		expect(data.data.threads).toEqual([]);
	});

	it("200 for Admin probing a staff-visibility forum", async () => {
		const token = await makeToken(1);
		const { db } = createMockDb({
			firstResults: {
				// optionalAuthVerified uses `SELECT role, status FROM users WHERE id = ?`,
				// which is *not* a substring of the moderationMiddleware mock — supply
				// a dedicated row so the JWT lookup returns role=Admin and the staff
				// visibility gate passes.
				"SELECT role, status FROM users WHERE id": { role: 1, status: 0 },
				...mockForumVis(1, "staff"),
			},
			allResults: { "FROM forum_recommended_threads r": [] },
		});
		const env = makeEnv({ DB: db });
		const res = await listRecommendedThreads(listRequest(1, token), env);
		expect(res.status).toBe(200);
	});
});
