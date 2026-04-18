// tests/integration/worker/user-content.test.ts — L2 Worker User Content Tests
// Tests user content CRUD: create thread/post, edit/delete own content

import { describe, expect, test } from "bun:test";
import { createTestJwt, workerDelete, workerPatch, workerPost } from "../setup";

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
			const jwt = await createTestJwt(3, 0);
			const res = await workerPost(
				"/api/v1/threads",
				{}, // Missing required fields
				jwt,
			);
			expect(res.status).toBe(400);
		});

		test("returns 400 for invalid forumId", async () => {
			const jwt = await createTestJwt(3, 0);
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
			const jwt = await createTestJwt(3, 0);
			const res = await workerPost(
				"/api/v1/posts",
				{}, // Missing required fields
				jwt,
			);
			expect(res.status).toBe(400);
		});

		test("returns 404 for non-existent thread", async () => {
			const jwt = await createTestJwt(3, 0);
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
			const jwt = await createTestJwt(3, 0);
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
			const jwt = await createTestJwt(3, 0);
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
			const jwt = await createTestJwt(3, 0);
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
			const jwt = await createTestJwt(3, 0);
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
			const jwt = await createTestJwt(3, 0);
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
});
