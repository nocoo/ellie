import { describe, expect, it } from "vitest";
import {
	banUser,
	deletePost,
	deleteThread,
	editPost,
	getUserIpRecords,
	getUserStatus,
	moveThread,
	muteUser,
	nukeUser,
	setClose,
	setDigest,
	setHighlight,
	setSticky,
	unbanUser,
	unmuteUser,
} from "../../../src/handlers/moderation";
import { createJwt } from "../../../src/lib/jwt";
import { TEST_JWT_SECRET, createMockDb, makeEnv } from "../../helpers";

// ─── Helpers ──────────────────────────────────────────────────────

async function makeModToken(role: number, userId = 1): Promise<string> {
	return createJwt({ userId, role, exp: Math.floor(Date.now() / 1000) + 3600 }, TEST_JWT_SECRET);
}

function modRequest(method: string, path: string, token: string, body?: unknown): Request {
	return new Request(`https://api.example.com${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

// ─── Permission Mock Data ─────────────────────────────────────────
// These helper functions create the mock data needed for permission checks

/** Mock data for moderationMiddleware DB role + status + email-verification check.
 *  email_verified_at defaults to a positive value (verified) so existing tests
 *  bypass the docs/17 §5.4 gate. Pass `email_verified_at: 0` explicitly to test
 *  the unverified branch. */
function mockAuthUser(role = 1, status = 0, email_verified_at = 1700000000) {
	return {
		"SELECT role, status, email_verified_at FROM users WHERE id": {
			role,
			status,
			email_verified_at,
		},
	};
}

/** Mock data for user permission check (supports both middleware auth and permission helper queries) */
function mockUser(userId = 1, role = 1, username = "admin") {
	return {
		// For moderationMiddleware DB role + status + email-verification check
		"SELECT role, status, email_verified_at FROM users WHERE id": {
			role,
			status: 0,
			email_verified_at: 1700000000,
		},
		// For getUserForPermission
		"SELECT id, username, role, status FROM users": { id: userId, username, role, status: 0 },
	};
}

/** Mock data for forum permission check */
function mockForum(forumId = 1, moderators = "") {
	return {
		"SELECT id, moderators, moderator_ids FROM forums": {
			id: forumId,
			moderators,
			moderator_ids: "",
		},
	};
}

/** Mock data for thread permission check */
function mockThread(threadId = 1, forumId = 1, authorId = 10) {
	return {
		"SELECT id, forum_id, author_id FROM threads": {
			id: threadId,
			forum_id: forumId,
			author_id: authorId,
		},
	};
}

// ─── setSticky ──────────────────────────────────────────────────

describe("PATCH /api/v1/moderation/threads/:id/sticky", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/sticky", {
			method: "PATCH",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 403 for regular user (role 0)", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) }, // DB confirms role 0
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/sticky", token, {
			level: "forum",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 for invalid level", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) }, // DB confirms Admin role
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/sticky", token, {
			level: "invalid",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error.code).toBe("INVALID_BODY");
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) }, // DB confirms Admin role, but no thread
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/999/sticky", token, {
			level: "forum",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(404);
	});

	it("should set sticky to forum (level 1) for Admin", async () => {
		const token = await makeModToken(1); // Admin
		const { db, calls } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/sticky", token, {
			level: "forum",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.id).toBe(1);
		expect(data.data.sticky).toBe(1);

		const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET sticky"));
		expect(updateCall).toBeDefined();
		expect(updateCall?.params).toEqual([1, 1]);
	});

	it("should set sticky to global (level 2) for Mod in scope", async () => {
		const token = await makeModToken(3, 2); // Mod, userId=2
		const { db } = createMockDb({
			firstResults: {
				...mockThread(5, 1, 10),
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "moduser,othermod"), // moduser is in moderators list
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/5/sticky", token, {
			level: "global",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.sticky).toBe(2);
	});

	it("should return 403 for Mod out of scope", async () => {
		const token = await makeModToken(3, 2); // Mod, userId=2
		const { db } = createMockDb({
			firstResults: {
				...mockThread(5, 1, 10),
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "othermod"), // moduser NOT in moderators list
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/5/sticky", token, {
			level: "global",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(403);
	});

	it("should set sticky to none (level 0)", async () => {
		const token = await makeModToken(2); // SuperMod
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 2, "supermod"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/sticky", token, {
			level: "none",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.sticky).toBe(0);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/sticky", {
			method: "PATCH",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: "not json",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(400);
	});
});

// ─── setDigest ──────────────────────────────────────────────────

describe("PATCH /api/v1/moderation/threads/:id/digest", () => {
	it("should return 403 for regular user", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 1 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 for non-integer level", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, {
			level: "high",
		});
		const res = await setDigest(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for out-of-range level", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 5 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/999/digest", token, { level: 2 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(404);
	});

	it("should set digest level for Mod in scope", async () => {
		const token = await makeModToken(3, 2); // Mod, userId=2
		const { db, calls } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 2 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.digest).toBe(2);

		const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET digest"));
		expect(updateCall).toBeDefined();
		expect(updateCall?.params).toEqual([2, 1]);
	});
});

// ─── setClose ──────────────────────────────────────────────────

describe("PATCH /api/v1/moderation/threads/:id/close", () => {
	it("should return 403 for regular user", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: true });
		const res = await setClose(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 when closed is not boolean", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: 1 });
		const res = await setClose(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/999/close", token, {
			closed: true,
		});
		const res = await setClose(req, env);
		expect(res.status).toBe(404);
	});

	it("should close thread (closed=true → 1)", async () => {
		const token = await makeModToken(2); // SuperMod
		const { db, calls } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 2, "supermod"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: true });
		const res = await setClose(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.closed).toBe(1);

		const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET closed"));
		expect(updateCall?.params).toEqual([1, 1]);
	});

	it("should reopen thread (closed=false → 0)", async () => {
		const token = await makeModToken(1); // Admin
		const { db } = createMockDb({
			firstResults: {
				...mockThread(3, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/3/close", token, { closed: false });
		const res = await setClose(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.closed).toBe(0);
	});
});

// ─── moveThread ──────────────────────────────────────────────────

describe("PATCH /api/v1/moderation/threads/:id/move", () => {
	it("should return 403 for regular user", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 403 for Mod (Mods cannot move threads)", async () => {
		const token = await makeModToken(3, 2); // Mod
		const { db } = createMockDb({
			firstResults: {
				...mockUser(2, 3, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.details.message).toBe("Only Admin or SuperMod can move threads");
	});

	it("should return 400 for invalid targetForumId", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: "abc",
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/999/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(404);
	});

	it("should return moved=false when thread is already in target forum", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, forum_id, replies FROM threads": { id: 1, forum_id: 2, replies: 5 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.moved).toBe(false);
	});

	it("should return 400 when target forum not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, forum_id, replies FROM threads": { id: 1, forum_id: 1, replies: 3 },
				// "SELECT id FROM forums" returns null (not found)
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 999,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error.details.message).toBe("Target forum not found");
	});

	it("should move thread and return moved=true for Admin", async () => {
		const token = await makeModToken(1);
		const { db, batchCalls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, forum_id, replies FROM threads": { id: 1, forum_id: 1, replies: 5 },
				"SELECT id FROM forums WHERE id": { id: 2 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.moved).toBe(true);
		expect(data.data.forumId).toBe(2);
		// batch should have been called with 4 statements
		expect(batchCalls.length).toBe(1);
	});

	it("should move thread for SuperMod", async () => {
		const token = await makeModToken(2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 2, "supermod"),
				"SELECT id, forum_id, replies FROM threads": { id: 1, forum_id: 1, replies: 5 },
				"SELECT id FROM forums WHERE id": { id: 2 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.moved).toBe(true);
	});
});

// ─── deletePost ──────────────────────────────────────────────────

describe("DELETE /api/v1/moderation/posts/:id", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/moderation/posts/1", {
			method: "DELETE",
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 403 for regular user", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) },
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 404 when post not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/999", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 400 when trying to delete first post", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 1,
					thread_id: 1,
					forum_id: 1,
					author_id: 10,
					is_first: 1,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error.code).toBe("CANNOT_DELETE_FIRST_POST");
	});

	it("should delete non-first post for Admin", async () => {
		const token = await makeModToken(1); // Admin role
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 5,
					thread_id: 1,
					forum_id: 1,
					author_id: 10,
					is_first: 0,
				},
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/5", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.deleted).toBe(true);
		expect(data.data.id).toBe(5);
		// batch should have DELETE + two UPDATE statements
		expect(batchCalls.length).toBe(1);
	});

	it("should return 403 for Mod trying to delete others' post (Mods CANNOT delete)", async () => {
		const token = await makeModToken(3, 2); // Mod role, userId=2
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 5,
					thread_id: 1,
					forum_id: 1,
					author_id: 10, // Different from userId=2
					is_first: 0,
				},
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "moduser"), // Even though Mod is in scope
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/5", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.details.message).toBe("No permission to delete this post");
	});

	it("should allow author to delete their own post", async () => {
		const token = await makeModToken(3, 10); // Mod role, userId=10 (same as author)
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 5,
					thread_id: 1,
					forum_id: 1,
					author_id: 10, // Same as userId=10
					is_first: 0,
				},
				...mockUser(10, 3, "moduser"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/5", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.deleted).toBe(true);
		expect(batchCalls.length).toBe(1);
	});

	it("recalculates thread metadata before forum metadata (R3-A)", async () => {
		// Regression: moderation deletePost used to skip
		// recalcThreadMetadata, leaving threads.last_post_at /
		// last_poster pointing at the now-deleted post; the subsequent
		// forum recalc would then read stale per-thread aggregates.
		const token = await makeModToken(1); // Admin
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 9,
					thread_id: 42,
					forum_id: 7,
					author_id: 10,
					is_first: 0,
				},
				...mockUser(1, 1, "admin"),
				...mockForum(7, ""),
				// recalcThreadMetadata: most recent visible post in this thread
				"SELECT created_at, author_name, author_id": {
					created_at: 1700001234,
					author_name: "alice",
					author_id: 10,
				},
				// recalcForumMetadata: most recent visible thread in this forum
				"SELECT id, subject, last_post_at, last_poster, last_poster_id": {
					id: 42,
					subject: "t",
					last_post_at: 1700001234,
					last_poster: "alice",
					last_poster_id: 10,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/9", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(200);

		const threadRecalcIdx = calls.findIndex(
			(c) =>
				c.sql.includes("SELECT created_at, author_name, author_id") &&
				c.sql.includes("FROM posts") &&
				c.params[0] === 42,
		);
		const forumRecalcIdx = calls.findIndex(
			(c) =>
				c.sql.includes("SELECT id, subject, last_post_at, last_poster, last_poster_id") &&
				c.params[0] === 7,
		);
		expect(threadRecalcIdx).toBeGreaterThanOrEqual(0);
		expect(forumRecalcIdx).toBeGreaterThanOrEqual(0);
		expect(threadRecalcIdx).toBeLessThan(forumRecalcIdx);
	});

	it("purges attachments + post_comments by post_id BEFORE DELETE FROM posts (FK regression)", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 9,
					thread_id: 42,
					forum_id: 7,
					author_id: 10,
					is_first: 0,
				},
				...mockUser(1, 1, "admin"),
				...mockForum(7, ""),
				"SELECT created_at, author_name, author_id": {
					created_at: 1700001234,
					author_name: "alice",
					author_id: 10,
				},
				"SELECT id, subject, last_post_at, last_poster, last_poster_id": {
					id: 42,
					subject: "t",
					last_post_at: 1700001234,
					last_poster: "alice",
					last_poster_id: 10,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/9", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(200);

		const idxAtt = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM attachments WHERE post_id IN"),
		);
		const idxComments = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM post_comments WHERE post_id IN"),
		);
		const idxPost = calls.findIndex((c) => c.sql.startsWith("DELETE FROM posts WHERE id"));
		expect(idxAtt).toBeGreaterThanOrEqual(0);
		expect(idxComments).toBeGreaterThanOrEqual(0);
		expect(idxPost).toBeGreaterThan(idxAtt);
		expect(idxPost).toBeGreaterThan(idxComments);
	});
});

// ═══════════════════════════════════════════════════════════════════
// User Moderation Tests
// ═══════════════════════════════════════════════════════════════════

// Helper for user moderation requests
function userModRequest(method: string, path: string, token: string, body?: unknown): Request {
	return new Request(`https://api.example.com${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	});
}

// ─── muteUser ──────────────────────────────────────────────────

describe("POST /api/v1/moderation/users/:id/mute", () => {
	it("should return 403 for regular user", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 403 for Mod (only Admin/SuperMod can mute)", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(2, 3, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.details.message).toBe("Only Admin or SuperMod can mute users");
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				// Target user query returns null
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/999/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 403 when trying to mute Admin", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "otheradmin",
					status: 0,
					role: 1,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.details.message).toBe("Cannot mute Admin or SuperMod users");
	});

	it("should mute regular user successfully", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "baduser",
					status: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.muted).toBe(true);
		expect(data.data.userId).toBe(10);

		// Verify UPDATE was called with status = -2
		const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET status = -2"));
		expect(updateCall).toBeDefined();
	});

	it("should allow SuperMod to mute users", async () => {
		const token = await makeModToken(2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 2, "supermod"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "baduser",
					status: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(200);
	});
});

// ─── unmuteUser ────────────────────────────────────────────────

describe("POST /api/v1/moderation/users/:id/unmute", () => {
	it("should return 403 for Mod", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(2, 3, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unmute", token);
		const res = await unmuteUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 when user is not muted", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status FROM users": { id: 10, username: "normaluser", status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unmute", token);
		const res = await unmuteUser(req, env);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error.details.message).toBe("User is not currently muted");
	});

	it("should unmute muted user successfully", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status FROM users": { id: 10, username: "muteduser", status: -2 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unmute", token);
		const res = await unmuteUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.unmuted).toBe(true);

		// Verify UPDATE was called with status = 0
		const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET status = 0"));
		expect(updateCall).toBeDefined();
	});
});

// ─── banUser ───────────────────────────────────────────────────

describe("POST /api/v1/moderation/users/:id/ban", () => {
	it("should return 403 for Mod", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(2, 3, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 403 when trying to ban SuperMod", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "supermod",
					status: 0,
					role: 2,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should ban regular user successfully", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "baduser",
					status: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.banned).toBe(true);

		// Verify UPDATE was called with status = -1
		const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET status = -1"));
		expect(updateCall).toBeDefined();
	});
});

// ─── unbanUser ─────────────────────────────────────────────────

describe("POST /api/v1/moderation/users/:id/unban", () => {
	it("should return 400 when user is not banned", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status FROM users": { id: 10, username: "normaluser", status: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unban", token);
		const res = await unbanUser(req, env);
		expect(res.status).toBe(400);
	});

	it("should unban banned user successfully", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status FROM users": { id: 10, username: "banneduser", status: -1 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unban", token);
		const res = await unbanUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.unbanned).toBe(true);

		// Verify UPDATE was called with status = 0
		const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET status = 0"));
		expect(updateCall).toBeDefined();
	});
});

// ─── nukeUser ──────────────────────────────────────────────────

describe("POST /api/v1/moderation/users/:id/nuke", () => {
	it("should return 403 for Mod", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(2, 3, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 403 when trying to nuke Admin", async () => {
		const token = await makeModToken(2); // SuperMod
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 2, "supermod"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "admin",
					status: 0,
					role: 1,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should nuke regular user successfully", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "spammer",
					status: 0,
					role: 0,
				},
			},
			allResults: {
				"SELECT id, forum_id, replies, digest FROM threads WHERE author_id": [],
				"SELECT forum_id, COUNT": [],
				"SELECT thread_id, COUNT": [],
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.nuked).toBe(true);
		expect(data.data.userId).toBe(10);

		// Verify the final UPDATE was called
		const updateCall = calls.find((c) =>
			c.sql.includes("UPDATE users SET status = -1, threads = 0, posts = 0, credits = 0"),
		);
		expect(updateCall).toBeDefined();
	});

	it("purges FK children via subquery batches BEFORE deleting parent rows (FK regression)", async () => {
		const token = await makeModToken(1);
		const { db, calls, batchCalls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "spammer",
					status: 0,
					role: 0,
				},
				"SELECT COUNT(*) as cnt FROM attachments WHERE author_id": { cnt: 0 },
			},
			allResults: {
				"SELECT id, forum_id, replies, digest FROM threads WHERE author_id": [
					{ id: 30, forum_id: 1, replies: 1, digest: 0 },
				],
				"SELECT forum_id, COUNT(*) as cnt FROM posts": [{ forum_id: 1, cnt: 1 }],
				"SELECT thread_id, COUNT(*) as cnt FROM posts": [{ thread_id: 40, cnt: 1 }],
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(200);

		// ── Verify subquery-based FK child purge SQL exists ──
		const fkPurgeAtt = calls.find((c) =>
			c.sql.includes("DELETE FROM attachments WHERE thread_id IN (SELECT"),
		);
		const fkPurgeComm = calls.find((c) =>
			c.sql.includes("DELETE FROM post_comments WHERE thread_id IN (SELECT"),
		);
		const fkPurgeAttPost = calls.find((c) =>
			c.sql.includes("DELETE FROM attachments WHERE post_id IN (SELECT"),
		);
		const fkPurgeCommPost = calls.find((c) =>
			c.sql.includes("DELETE FROM post_comments WHERE post_id IN (SELECT"),
		);
		expect(fkPurgeAtt).toBeDefined();
		expect(fkPurgeComm).toBeDefined();
		expect(fkPurgeAttPost).toBeDefined();
		expect(fkPurgeCommPost).toBeDefined();

		// ── Verify subquery-based core delete SQL exists ──
		const deletePosts = calls.find((c) =>
			c.sql.includes("DELETE FROM posts WHERE thread_id IN (SELECT"),
		);
		const deleteStandalone = calls.find(
			(c) =>
				c.sql.includes("DELETE FROM posts WHERE author_id") && c.sql.includes("thread_id NOT IN"),
		);
		const deleteThreads = calls.find((c) => c.sql.includes("DELETE FROM threads WHERE author_id"));
		expect(deletePosts).toBeDefined();
		expect(deleteStandalone).toBeDefined();
		expect(deleteThreads).toBeDefined();

		// ── Verify batch ordering: all 7 delete stmts in ONE batch ──
		// The deletion batch is a single atomic unit. Find the batch that
		// contains the FK purge + core deletes (7 statements).
		const deleteBatch = batchCalls.find(
			(batch) =>
				batch.length === 7 &&
				calls.some((c) => c.sql.includes("DELETE FROM attachments WHERE thread_id IN (SELECT")),
		);
		expect(deleteBatch).toBeDefined();
		// Verify the batch is well under D1 limits
		expect(deleteBatch?.length).toBeLessThanOrEqual(80);

		// Verify ordering within calls: FK purge before parent deletes
		const idxFkAtt = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM attachments WHERE thread_id IN (SELECT"),
		);
		const idxDeletePosts = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM posts WHERE thread_id IN (SELECT"),
		);
		const idxDeleteThreads = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM threads WHERE author_id"),
		);
		expect(idxFkAtt).toBeLessThan(idxDeletePosts);
		expect(idxDeletePosts).toBeLessThan(idxDeleteThreads);

		// ── Verify NO expanded ID arrays in delete SQL ──
		// Old code used IN (?,?,?,...) with literal IDs; new code uses subqueries.
		const expandedIn = calls.find(
			(c) =>
				(c.sql.includes("DELETE FROM attachments WHERE thread_id IN (?") ||
					c.sql.includes("DELETE FROM post_comments WHERE thread_id IN (?") ||
					c.sql.includes("DELETE FROM posts WHERE thread_id = ?") ||
					c.sql.includes("DELETE FROM threads WHERE id = ?")) &&
				!c.sql.includes("SELECT"),
		);
		expect(expandedIn).toBeUndefined();
	});

	it("handles large data users without generating expanded IN() or oversized batches", async () => {
		// Simulate a user with many threads and standalone posts.
		// The old implementation would generate N statements per thread and
		// expand all IDs into IN(...) placeholders, exceeding D1 limits.
		const THREAD_COUNT = 200;
		const STANDALONE_FORUM_COUNT = 5;
		const threadRows = Array.from({ length: THREAD_COUNT }, (_, i) => ({
			id: 1000 + i,
			forum_id: (i % 3) + 1,
			replies: 10,
			digest: i === 0 ? 1 : 0,
		}));
		const standaloneForumRows = Array.from({ length: STANDALONE_FORUM_COUNT }, (_, i) => ({
			forum_id: 10 + i,
			cnt: 50,
		}));
		const standaloneThreadRows = Array.from({ length: 100 }, (_, i) => ({
			thread_id: 5000 + i,
			cnt: 3,
		}));

		const token = await makeModToken(1);
		const { db, calls, batchCalls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 99,
					username: "heavy-poster",
					status: 0,
					role: 0,
				},
				"SELECT COUNT(*) as cnt FROM attachments WHERE author_id": { cnt: 500 },
			},
			allResults: {
				"SELECT id, forum_id, replies, digest FROM threads WHERE author_id": threadRows,
				"SELECT forum_id, COUNT(*) as cnt FROM posts WHERE author_id": standaloneForumRows,
				"SELECT thread_id, COUNT(*) as cnt FROM posts WHERE author_id": standaloneThreadRows,
				"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN (SELECT": [
					{ author_id: 200, cnt: 50 },
					{ author_id: 201, cnt: 30 },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/99/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(200);

		const data = (await res.json()) as { data: { threadsDeleted: number; postsDeleted: number } };
		expect(data.data.threadsDeleted).toBe(THREAD_COUNT);

		// No DELETE SQL should contain expanded IN (?,?,?,...) patterns with
		// literal placeholder arrays — all multi-row deletes must use subqueries.
		// Simple WHERE author_id = ? (single param) is fine.
		for (const c of calls) {
			if (!c.sql.includes("DELETE FROM")) continue;
			// Check for expanded IN patterns: IN (?,?,...) without a SELECT subquery
			const hasExpandedIn = /IN\s*\(\s*\?/.test(c.sql) && !c.sql.includes("SELECT");
			if (hasExpandedIn) {
				throw new Error(`Found expanded IN() DELETE: ${c.sql}`);
			}
		}

		// Collateral author query must use subquery, not expanded IN(...)
		const collateralQuery = calls.find(
			(c) => c.sql.includes("SELECT author_id, COUNT(*)") && c.sql.includes("thread_id IN (SELECT"),
		);
		expect(collateralQuery).toBeDefined();
		// Must NOT have an expanded IN with literal placeholders
		const expandedCollateral = calls.find(
			(c) =>
				c.sql.includes("SELECT author_id, COUNT(*)") &&
				c.sql.includes("thread_id IN (?") &&
				!c.sql.includes("SELECT id FROM threads"),
		);
		expect(expandedCollateral).toBeUndefined();

		// Counter update batches must be chunked (each batch ≤ 80 statements)
		for (const batch of batchCalls) {
			expect(batch.length).toBeLessThanOrEqual(80);
		}

		// The deletion batch must be exactly 7 statements (fixed, regardless of data size)
		const deleteBatch = batchCalls.find((batch) => batch.length === 7);
		expect(deleteBatch).toBeDefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// getUserStatus tests
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/moderation/users/:id/status", () => {
	it("should return 403 for Mod", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(2, 3, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/status", token);
		const res = await getUserStatus(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				// Target user query returns null
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/999/status", token);
		const res = await getUserStatus(req, env);
		expect(res.status).toBe(404);
	});

	it("should return user status for Admin", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status FROM users": {
					id: 10,
					username: "targetuser",
					status: -2, // muted
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/status", token);
		const res = await getUserStatus(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.userId).toBe(10);
		expect(data.data.username).toBe("targetuser");
		expect(data.data.status).toBe(-2);
	});

	it("should return user status for SuperMod", async () => {
		const token = await makeModToken(2);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 2, "supermod"),
				"SELECT id, username, status FROM users": {
					id: 10,
					username: "banneduser",
					status: -1, // banned
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/status", token);
		const res = await getUserStatus(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.status).toBe(-1);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// setSticky — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("setSticky — edge cases", () => {
	it("should return 400 for invalid thread ID (non-numeric path)", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/abc/sticky", token, {
			level: "forum",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user or forum fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, forum_id, author_id FROM threads": { id: 1, forum_id: 1, author_id: 10 },
				// getUserForPermission and getForumForPermission return null
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/sticky", token, {
			level: "forum",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(500);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// setDigest — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("setDigest — edge cases", () => {
	it("should return 400 for invalid thread ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/abc/digest", token, { level: 1 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/digest", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await setDigest(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user or forum fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, forum_id, author_id FROM threads": { id: 1, forum_id: 1, author_id: 10 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 2 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 403 for Mod out of scope", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 1 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(403);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// setClose — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("setClose — edge cases", () => {
	it("should return 400 for invalid thread ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/abc/close", token, {
			closed: true,
		});
		const res = await setClose(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/close", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await setClose(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user or forum fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, forum_id, author_id FROM threads": { id: 1, forum_id: 1, author_id: 10 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: true });
		const res = await setClose(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 403 for Mod out of scope", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: true });
		const res = await setClose(req, env);
		expect(res.status).toBe(403);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// moveThread — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("moveThread — edge cases", () => {
	it("should return 400 for invalid thread ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/abc/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/move", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(1) },
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: 2,
		});
		const res = await moveThread(req, env);
		// getUserForPermission returns null → 500
		expect(res.status).toBe(500);
	});

	it("should return 400 for negative targetForumId", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/move", token, {
			targetForumId: -1,
		});
		const res = await moveThread(req, env);
		expect(res.status).toBe(400);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// deletePost — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("deletePost — edge cases", () => {
	it("should return 400 for invalid post ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/abc", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user or forum fetch fails for permission check", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
					id: 5,
					thread_id: 1,
					forum_id: 1,
					author_id: 10,
					is_first: 0,
				},
				// No user/forum results → null
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/5", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deletePost(req, env);
		expect(res.status).toBe(500);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// setHighlight tests
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/v1/moderation/threads/:id/highlight", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/highlight", {
			method: "PATCH",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 400 for invalid thread ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/abc/highlight", token, {
			color: "#ff0000",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1/highlight", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for invalid color format", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "red",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error.code).toBe("INVALID_BODY");
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/999/highlight", token, {
			color: null,
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 500 when user or forum fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, forum_id, author_id FROM threads": { id: 1, forum_id: 1, author_id: 10 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "#ff0000",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 403 for Mod out of scope", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "othermod"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "#ff0000",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(403);
	});

	it("should set highlight with 6-digit hex color for Admin", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "#ff0000",
			bold: true,
			italic: false,
			underline: false,
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.id).toBe(1);
		// #ff0000 = 16711680, bold bit 24 = 16777216, total = 33488896
		expect(data.data.highlight).toBe(0xff0000 | (1 << 24));
	});

	it("should set highlight with 3-digit hex color", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "#f00",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.highlight).toBe(0xff0000);
	});

	it("should remove highlight with null color", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: null,
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.highlight).toBe(0);
	});

	it("should encode italic and underline flags", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "#000001",
			bold: false,
			italic: true,
			underline: true,
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		// 1 | (1<<25) | (1<<26) = 1 + 33554432 + 67108864
		expect(data.data.highlight).toBe(1 | (1 << 25) | (1 << 26));
	});

	it("should return 0 for invalid hex length (e.g. 4 digits)", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		// Color with 4 hex digits won't match regex, so it returns 400
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {
			color: "#ffff",
		});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(400);
	});

	it("should pass color=undefined (no color key) and set highlight to 0", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockThread(1, 1, 10),
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
			},
		});
		const env = makeEnv({ DB: db });
		// No color key at all → color is undefined, treated same as null
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/highlight", token, {});
		const res = await setHighlight(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.highlight).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// deleteThread tests
// ═══════════════════════════════════════════════════════════════════════════

describe("DELETE /api/v1/moderation/threads/:id", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1", {
			method: "DELETE",
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 400 for invalid thread ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/abc", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/999", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 500 when user or forum fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, forum_id, author_id, replies, digest FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 3,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 403 for Mod trying to delete others' thread", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, forum_id, author_id, replies, digest FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 3,
				},
				...mockUser(2, 3, "moduser"),
				...mockForum(1, "moduser"),
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(403);
	});

	it("should delete thread for Admin", async () => {
		const token = await makeModToken(1);
		const { db, batchCalls } = createMockDb({
			firstResults: {
				"SELECT id, forum_id, author_id, replies, digest FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 2,
				},
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
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
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.deleted).toBe(true);
		expect(data.data.id).toBe(1);
		expect(batchCalls.length).toBeGreaterThanOrEqual(1);
	});

	it("should allow author to delete own thread even as Mod", async () => {
		const token = await makeModToken(3, 10); // Mod, userId=10, same as author
		const { db } = createMockDb({
			firstResults: {
				"SELECT id, forum_id, author_id, replies, digest FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 0,
				},
				...mockUser(10, 3, "moduser"),
				...mockForum(1, ""),
			},
			allResults: {
				"SELECT author_id FROM posts WHERE thread_id": [{ author_id: 10 }],
			},
		});
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/threads/1", {
			method: "DELETE",
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await deleteThread(req, env);
		expect(res.status).toBe(200);
	});

	it("purges attachments + post_comments by thread_id BEFORE DELETE FROM posts/threads (FK regression)", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT id, forum_id, author_id, replies, digest FROM threads": {
					id: 1,
					forum_id: 1,
					author_id: 10,
					replies: 2,
				},
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
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
		const res = await deleteThread(req, env);
		expect(res.status).toBe(200);

		const idxAtt = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM attachments WHERE thread_id IN"),
		);
		const idxComments = calls.findIndex((c) =>
			c.sql.includes("DELETE FROM post_comments WHERE thread_id IN"),
		);
		const idxPosts = calls.findIndex((c) => c.sql.includes("DELETE FROM posts WHERE thread_id"));
		const idxThread = calls.findIndex((c) => c.sql.startsWith("DELETE FROM threads WHERE id"));
		expect(idxAtt).toBeGreaterThanOrEqual(0);
		expect(idxComments).toBeGreaterThanOrEqual(0);
		expect(idxPosts).toBeGreaterThan(idxAtt);
		expect(idxPosts).toBeGreaterThan(idxComments);
		expect(idxThread).toBeGreaterThan(idxPosts);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// editPost tests
// ═══════════════════════════════════════════════════════════════════════════

describe("PATCH /api/v1/moderation/posts/:id (editPost)", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/moderation/posts/1", {
			method: "PATCH",
		});
		const res = await editPost(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 400 for invalid post ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/abc", token, {
			content: "updated",
		});
		const res = await editPost(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for invalid JSON body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = new Request("https://api.example.com/api/v1/moderation/posts/1", {
			method: "PATCH",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await editPost(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for empty content", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/1", token, { content: "" });
		const res = await editPost(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for whitespace-only content", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/1", token, { content: "   " });
		const res = await editPost(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for non-string content", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/1", token, { content: 123 });
		const res = await editPost(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when post not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/999", token, {
			content: "updated",
		});
		const res = await editPost(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 500 when user or forum fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(1),
				"SELECT id, author_id, forum_id FROM posts": { id: 1, authorId: 10, forumId: 1 },
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/1", token, { content: "updated" });
		const res = await editPost(req, env);
		// getPostForPermission uses different query key
		expect(res.status).toBe(404);
	});

	it("should return 403 for user without edit permission", async () => {
		const token = await makeModToken(0, 5); // regular user, not author
		const { db } = createMockDb({
			firstResults: {
				...mockAuthUser(0),
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/1", token, { content: "updated" });
		const res = await editPost(req, env);
		expect(res.status).toBe(403);
	});

	it("should edit post for Admin", async () => {
		const token = await makeModToken(1);
		const { db, calls } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				...mockForum(1, ""),
				"SELECT id, author_id, forum_id, thread_id, is_first FROM posts": {
					id: 5,
					author_id: 10,
					forum_id: 1,
					thread_id: 1,
					is_first: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/posts/5", token, {
			content: "  edited content  ",
		});
		const res = await editPost(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.id).toBe(5);
		expect(data.data.updated).toBe(true);

		const updateCall = calls.find((c) => c.sql.includes("UPDATE posts SET content"));
		expect(updateCall).toBeDefined();
		// Content should be trimmed
		expect(updateCall?.params[0]).toBe("edited content");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// getUserIpRecords tests
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/moderation/users/:id/ip-records", () => {
	it("should return 401 without auth", async () => {
		const env = makeEnv();
		const req = new Request("https://api.example.com/api/v1/moderation/users/10/ip-records", {
			method: "GET",
		});
		const res = await getUserIpRecords(req, env);
		expect(res.status).toBe(401);
	});

	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/abc/ip-records", token);
		const res = await getUserIpRecords(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/ip-records", token);
		const res = await getUserIpRecords(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 403 for Mod", async () => {
		const token = await makeModToken(3, 2);
		const { db } = createMockDb({
			firstResults: { ...mockUser(2, 3, "moduser") },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/ip-records", token);
		const res = await getUserIpRecords(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockUser(1, 1, "admin") },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/999/ip-records", token);
		const res = await getUserIpRecords(req, env);
		expect(res.status).toBe(404);
	});

	it("should return empty IP records for Admin", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username FROM users": { id: 10, username: "targetuser" },
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/ip-records", token);
		const res = await getUserIpRecords(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.userId).toBe(10);
		expect(data.data.ipRecords).toEqual([]);
		expect(data.data.message).toContain("not currently enabled");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// getUserStatus — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("getUserStatus — edge cases", () => {
	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/abc/status", token);
		const res = await getUserStatus(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("GET", "/api/v1/moderation/users/10/status", token);
		const res = await getUserStatus(req, env);
		expect(res.status).toBe(500);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// muteUser — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("muteUser — edge cases", () => {
	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/abc/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 403 when trying to mute SuperMod", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "supermod",
					status: 0,
					role: 2,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token);
		const res = await muteUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should mute with optional duration in body", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "baduser",
					status: 0,
					role: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/mute", token, {
			duration: "7d",
		});
		const res = await muteUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.duration).toBe("7d");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// unmuteUser — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("unmuteUser — edge cases", () => {
	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/abc/unmute", token);
		const res = await unmuteUser(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unmute", token);
		const res = await unmuteUser(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockUser(1, 1, "admin") },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/999/unmute", token);
		const res = await unmuteUser(req, env);
		expect(res.status).toBe(404);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// banUser — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("banUser — edge cases", () => {
	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/abc/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockUser(1, 1, "admin") },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/999/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 403 when trying to ban Admin", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "otheradmin",
					status: 0,
					role: 1,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/ban", token);
		const res = await banUser(req, env);
		expect(res.status).toBe(403);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// unbanUser — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("unbanUser — edge cases", () => {
	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/abc/unban", token);
		const res = await unbanUser(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unban", token);
		const res = await unbanUser(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockUser(1, 1, "admin") },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/999/unban", token);
		const res = await unbanUser(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 403 for regular user", async () => {
		const token = await makeModToken(0);
		const { db } = createMockDb({
			firstResults: { ...mockAuthUser(0) },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/unban", token);
		const res = await unbanUser(req, env);
		expect(res.status).toBe(403);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// nukeUser — edge cases
// ═══════════════════════════════════════════════════════════════════════════

describe("nukeUser — edge cases", () => {
	it("should return 400 for invalid user ID", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/abc/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 500 when user fetch fails", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({ firstResults: { ...mockAuthUser(1) } });
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(500);
	});

	it("should return 404 when target user not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: { ...mockUser(1, 1, "admin") },
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/999/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(404);
	});

	it("should return 403 when trying to nuke SuperMod", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "supermod",
					status: 0,
					role: 2,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(403);
	});

	it("should nuke user with threads and standalone posts", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb({
			firstResults: {
				...mockUser(1, 1, "admin"),
				"SELECT id, username, status, role FROM users": {
					id: 10,
					username: "spammer",
					status: 0,
					role: 0,
				},
				"SELECT COUNT(*) as cnt FROM attachments": { cnt: 3 },
			},
			allResults: {
				"SELECT id, forum_id, replies, digest FROM threads WHERE author_id": [
					{ id: 100, forum_id: 1, replies: 2 },
					{ id: 101, forum_id: 2, replies: 0 },
				],
				"SELECT forum_id, COUNT": [{ forum_id: 3, cnt: 5 }],
				"SELECT thread_id, COUNT": [{ thread_id: 200, cnt: 5 }],
				"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN": [
					{ author_id: 20, cnt: 1 },
				],
			},
		});
		const env = makeEnv({ DB: db });
		const req = userModRequest("POST", "/api/v1/moderation/users/10/nuke", token);
		const res = await nukeUser(req, env);
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.data.nuked).toBe(true);
		expect(data.data.threadsDeleted).toBe(2);
		expect(data.data.attachmentsDeleted).toBe(3);
	});
});
