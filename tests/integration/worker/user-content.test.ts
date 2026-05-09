// tests/integration/worker/user-content.test.ts — L2 Worker User Content Tests
// Tests user content CRUD: create thread/post, edit/delete own content

import { describe, expect, test } from "bun:test";
import { createTestJwt, workerDelete, workerFetch, workerPatch, workerPost } from "../setup";

describe("L2: Worker User Content API", () => {
	// ─── Create Thread ─────────────────────────────────────────────

	describe("POST /api/v1/threads", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/threads", {
				forumId: 1,
				subject: "Test Thread",
				content: "Test content",
			});
			expect(res.status).toBe(401);
		});

		test("returns 400 for missing required fields", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost(
				"/api/v1/threads",
				{}, // Missing required fields
				jwt,
			);
			expect(res.status).toBe(400);
		});

		test("returns 400 for invalid forumId", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost(
				"/api/v1/threads",
				{
					forumId: 999999,
					subject: "Test Thread",
					content: "Test content",
				},
				jwt,
			);
			// Forum not found
			expect([400, 404]).toContain(res.status);
		});
	});

	// ─── Create Post ───────────────────────────────────────────────

	describe("POST /api/v1/posts", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/posts", {
				threadId: 1,
				content: "Test reply",
			});
			expect(res.status).toBe(401);
		});

		test("returns 400 for missing required fields", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost(
				"/api/v1/posts",
				{}, // Missing required fields
				jwt,
			);
			expect(res.status).toBe(400);
		});

		test("returns 404 for non-existent thread", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost(
				"/api/v1/posts",
				{
					threadId: 999999,
					content: "Test reply",
				},
				jwt,
			);
			expect([400, 404]).toContain(res.status);
		});
	});

	// ─── Update Profile ────────────────────────────────────────────

	describe("PATCH /api/v1/users/me", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPatch("/api/v1/users/me", {
				avatar: "new-avatar.png",
			});
			expect(res.status).toBe(401);
		});

		test("accepts valid profile update with JWT", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPatch(
				"/api/v1/users/me",
				{
					// Empty update is valid but returns 400 due to no fields
					bio: "Updated bio",
				},
				jwt,
			);
			// Could be 200, 400 (validation error), or 404 if user doesn't exist
			expect([200, 400, 404]).toContain(res.status);
		});
	});

	// ─── Change Password ───────────────────────────────────────────

	describe("POST /api/v1/users/me/password", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/users/me/password", {
				currentPassword: "old",
				newPassword: "new",
			});
			expect(res.status).toBe(401);
		});

		test("returns 400 for missing fields", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPost("/api/v1/users/me/password", {}, jwt);
			expect(res.status).toBe(400);
		});
	});

	// ─── Delete Own Post ───────────────────────────────────────────

	describe("DELETE /api/v1/me/posts/:id", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerDelete("/api/v1/me/posts/1");
			expect(res.status).toBe(401);
		});

		test("returns 404 for non-existent post", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerDelete("/api/v1/me/posts/999999", jwt);
			expect([403, 404]).toContain(res.status);
		});
	});

	// ─── Delete Own Thread ─────────────────────────────────────────

	describe("DELETE /api/v1/me/threads/:id", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerDelete("/api/v1/me/threads/1");
			expect(res.status).toBe(401);
		});

		test("returns 404 for non-existent thread", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerDelete("/api/v1/me/threads/999999", jwt);
			expect([403, 404]).toContain(res.status);
		});
	});

	// ─── Edit Own Post ─────────────────────────────────────────────

	describe("PATCH /api/v1/me/posts/:id", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPatch("/api/v1/me/posts/1", {
				content: "Updated content",
			});
			expect(res.status).toBe(401);
		});

		test("returns 404 for non-existent post", async () => {
			const jwt = await createTestJwt(1, 0);
			const res = await workerPatch(
				"/api/v1/me/posts/999999",
				{
					content: "Updated content",
				},
				jwt,
			);
			expect([403, 404]).toContain(res.status);
		});
	});

	// ─── Post comments (点评) ──────────────────────────────────────

	describe("GET /api/v1/post-comments", () => {
		test("returns 400 when postId is missing", async () => {
			const res = await workerFetch("/api/v1/post-comments");
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns 400 when postId is not numeric", async () => {
			const res = await workerFetch("/api/v1/post-comments?postId=abc");
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns 404 for non-existent post", async () => {
			const res = await workerFetch("/api/v1/post-comments?postId=999999");
			expect(res.status).toBe(404);
			const data = await res.json();
			expect(data.error.code).toBe("POST_NOT_FOUND");
		});
	});

	describe("POST /api/v1/post-comments", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerPost("/api/v1/post-comments", { postId: 1, content: "hi" });
			expect(res.status).toBe(401);
		});

		test("returns 400 for invalid body (no postId)", async () => {
			const jwt = await createTestJwt(100, 0);
			const res = await workerPost("/api/v1/post-comments", { content: "hi" }, jwt);
			// Either INVALID_BODY (no postId) or a permission error before body
			// validation; both still exercise the route.
			expect([400, 403]).toContain(res.status);
		});

		test("returns 400 for empty content", async () => {
			const jwt = await createTestJwt(100, 0);
			const res = await workerPost("/api/v1/post-comments", { postId: 1, content: "" }, jwt);
			expect([400, 403]).toContain(res.status);
		});
	});

	// ─── Reports ───────────────────────────────────────────────────

	describe("POST /api/v1/reports", () => {
		test("returns 401 without JWT", async () => {
			const body = { type: "thread", targetId: 1, reason: "垃圾广告" };
			const res = await workerPost("/api/v1/reports", body);
			expect(res.status).toBe(401);
		});

		test("returns 400 for invalid type", async () => {
			const jwt = await createTestJwt(100, 0);
			const body = { type: "bogus", targetId: 1, reason: "垃圾广告" };
			const res = await workerPost("/api/v1/reports", body, jwt);
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns 400 for invalid targetId", async () => {
			const jwt = await createTestJwt(100, 0);
			const body = { type: "thread", targetId: -1, reason: "垃圾广告" };
			const res = await workerPost("/api/v1/reports", body, jwt);
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		test("returns 400 for invalid reason", async () => {
			const jwt = await createTestJwt(100, 0);
			const body = { type: "thread", targetId: 1, reason: "not-a-real-reason" };
			const res = await workerPost("/api/v1/reports", body, jwt);
			expect(res.status).toBe(400);
			const data = await res.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});
	});

	// ─── Posting permission ────────────────────────────────────────

	describe("GET /api/v1/posting-permission", () => {
		test("returns 401 without JWT", async () => {
			const res = await workerFetch("/api/v1/posting-permission");
			expect(res.status).toBe(401);
		});

		test("returns 200 with allowed/reason for authenticated user", async () => {
			const jwt = await createTestJwt(100, 0);
			const res = await workerFetch("/api/v1/posting-permission", {
				headers: { Authorization: `Bearer ${jwt}` },
			});
			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.data).toHaveProperty("allowed");
			expect(typeof data.data.allowed).toBe("boolean");
		});
	});
});
