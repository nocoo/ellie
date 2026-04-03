import { describe, expect, it } from "bun:test";
import {
	deletePost,
	moveThread,
	setClose,
	setDigest,
	setSticky,
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

/** Mock data for user permission check */
function mockUser(userId = 1, role = 1, username = "admin") {
	return {
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

/** Mock data for post permission check (reserved for future editPost/deleteThread tests) */
// biome-ignore lint/correctness/noUnusedVariables: Reserved for future use
function _mockPost(postId = 1, authorId = 10, forumId = 1, threadId = 1, isFirst = 0) {
	return {
		"SELECT id, author_id, forum_id, thread_id, is_first FROM posts": {
			id: postId,
			author_id: authorId,
			forum_id: forumId,
			thread_id: threadId,
			is_first: isFirst,
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
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/sticky", token, {
			level: "forum",
		});
		const res = await setSticky(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 for invalid level", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb();
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
		const { db } = createMockDb(); // default returns null for first()
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
		const { db } = createMockDb();
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
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 1 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 for non-integer level", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, {
			level: "high",
		});
		const res = await setDigest(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 400 for out-of-range level", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/digest", token, { level: 5 });
		const res = await setDigest(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb();
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
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: true });
		const res = await setClose(req, env);
		expect(res.status).toBe(403);
	});

	it("should return 400 when closed is not boolean", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const req = modRequest("PATCH", "/api/v1/moderation/threads/1/close", token, { closed: 1 });
		const res = await setClose(req, env);
		expect(res.status).toBe(400);
	});

	it("should return 404 when thread not found", async () => {
		const token = await makeModToken(1);
		const { db } = createMockDb();
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
		const { db } = createMockDb();
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
		const { db } = createMockDb();
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
		const { db } = createMockDb();
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
		const { db } = createMockDb();
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
});
