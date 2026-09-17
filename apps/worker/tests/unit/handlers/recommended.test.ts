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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { createMockDb, makeEnv, TEST_JWT_SECRET } from "../../helpers";

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
	let rf: ReturnType<typeof import("../lib/cache/thread-cache-fixture").readingFixture>;

	beforeEach(async () => {
		const { readingFixture } = await import("../lib/cache/thread-cache-fixture");
		rf = readingFixture();
	});

	afterEach(() => {
		rf.close();
	});

	it("400 INVALID_REQUEST for non-numeric forum id", async () => {
		const req = new Request("https://api.example.com/api/v1/forums/abc/recommended-threads", {
			method: "GET",
		});
		const res = await listRecommendedThreads(req, rf.env);
		expect(res.status).toBe(400);
	});

	it("404 FORUM_NOT_FOUND when forum row missing", async () => {
		const res = await listRecommendedThreads(listRequest(999), rf.env);
		expect(res.status).toBe(404);
		const data = (await res.json()) as { error: { code: string } };
		expect(data.error.code).toBe("FORUM_NOT_FOUND");
	});

	it("404 when forum is inactive (status != 1)", async () => {
		// forum 3 in fixture has status = 0
		const res = await listRecommendedThreads(listRequest(3), rf.env);
		expect(res.status).toBe(404);
	});

	it("404 when forum visibility = staff and caller is anonymous or regular member", async () => {
		// forum 2 in fixture is staff
		const anonRes = await listRecommendedThreads(listRequest(2), rf.env);
		expect(anonRes.status).toBe(404);

		const token = await makeToken(0, 10);
		const userRes = await listRecommendedThreads(listRequest(2, token), rf.env);
		expect(userRes.status).toBe(404);
	});

	it("200 for Admin probing a staff-visibility forum", async () => {
		const token = await makeToken(1, 1);
		const res = await listRecommendedThreads(listRequest(2, token), rf.env, rf.ctx);
		expect(res.status).toBe(200);
	});

	it("200 returns mapped threads ordered by thread_id DESC and capped to 6", async () => {
		for (let i = 1; i <= 8; i++) {
			rf.thread(i, { forum_id: 1, subject: `Thread ${i}`, author_id: 10, author_name: "alice" });
			rf.sqlite
				.prepare(
					"INSERT INTO forum_recommended_threads (forum_id, thread_id, recommended_by, recommended_at) VALUES (1, ?, 1, ?)",
				)
				.run(i, 1700000000 + i);
		}

		const res = await listRecommendedThreads(listRequest(1), rf.env, rf.ctx);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			data: { forumId: number; threads: { id: number; subject: string }[] };
		};
		expect(data.data.forumId).toBe(1);
		// Capped to 6, ordered by thread_id DESC
		expect(data.data.threads).toHaveLength(6);
		expect(data.data.threads.map((t) => t.id)).toEqual([8, 7, 6, 5, 4, 3]);
	});

	it("preserves anonymous-author masking even for staff viewers in recommendation cards", async () => {
		rf.thread(100, { forum_id: 1, anonymous_author: 1, author_id: 10, author_name: "alice" });
		rf.sqlite
			.prepare(
				"INSERT INTO forum_recommended_threads (forum_id, thread_id, recommended_by, recommended_at) VALUES (1, 100, 1, 1700000000)",
			)
			.run();

		// Even when requested by staff (admin role=1), anonymous author is masked on recommendation card
		const adminToken = await makeToken(1, 1);
		const res = await listRecommendedThreads(listRequest(1, adminToken), rf.env, rf.ctx);
		expect(res.status).toBe(200);
		const data = (await res.json()) as {
			data: { threads: { id: number; authorId: number; authorName: string }[] };
		};
		expect(data.data.threads[0].id).toBe(100);
		expect(data.data.threads[0].authorId).toBe(0);
		expect(data.data.threads[0].authorName).toBe("匿名");
	});

	it("200 empty list when no recommendations exist with SHORT tier cache envelope", async () => {
		const res = await listRecommendedThreads(listRequest(1), rf.env, rf.ctx);
		expect(res.status).toBe(200);
		const data = (await res.json()) as { data: { threads: unknown[] } };
		expect(data.data.threads).toEqual([]);
	});

	it("serves cached recommendations from KV without querying forum_recommended_threads catalog membership", async () => {
		rf.thread(50, { forum_id: 1 });
		// Reset calls recorded during thread setup
		rf.calls.length = 0;

		rf.sqlite
			.prepare(
				"INSERT INTO forum_recommended_threads (forum_id, thread_id, recommended_by, recommended_at) VALUES (1, 50, 1, 1700000000)",
			)
			.run();

		// Cold load
		const res1 = await listRecommendedThreads(listRequest(1), rf.env, rf.ctx);
		expect(res1.status).toBe(200);

		const membershipQuery = "SELECT r.thread_id AS id, r.recommended_at AS recommendedAt";
		const callsBefore = rf.calls.filter((c) => c.sql.includes(membershipQuery)).length;
		expect(callsBefore).toBe(1);

		// Hot load: cache hit for catalog membership
		const res2 = await listRecommendedThreads(listRequest(1), rf.env, rf.ctx);
		expect(res2.status).toBe(200);

		const callsAfter = rf.calls.filter((c) => c.sql.includes(membershipQuery)).length;
		expect(callsAfter).toBe(callsBefore);
	});
});
