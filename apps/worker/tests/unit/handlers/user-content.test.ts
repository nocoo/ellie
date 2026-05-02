import { describe, expect, it } from "vitest";
import { deleteMyPost, deleteMyThread, editMyPost } from "../../../src/handlers/user-content";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";
import {
	expectEmailNotVerifiedResponse,
	makeUnverifiedEnv,
	unverifiedUserJwt,
} from "../helpers/email-gate";

describe("user-content handlers", () => {
	// ─── deleteMyPost ───────────────────────────────────────────────

	describe("deleteMyPost", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "DELETE",
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject invalid post ID", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/abc", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 if post not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/99", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(404);
		});

		it("should forbid deleting another user's post", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
						id: 1,
						thread_id: 1,
						forum_id: 1,
						author_id: 99,
						is_first: 0,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(403);
		});

		it("should reject deleting the first post of a thread", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
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
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(400);
			const body = (await response.json()) as { error: { code: string } };
			expect(body.error.code).toBe("CANNOT_DELETE_FIRST_POST");
		});

		it("should delete own non-first post successfully", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
						id: 5,
						thread_id: 2,
						forum_id: 1,
						author_id: 10,
						is_first: 0,
					},
					// recalcForumMetadata queries
					"SELECT id FROM threads WHERE forum_id": { id: 2 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/5", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { deleted: boolean; id: number } };
			expect(body.data.deleted).toBe(true);
			expect(body.data.id).toBe(5);
		});

		it("recalculates thread metadata before forum metadata (R3-A)", async () => {
			// Regression: deleting a non-first post used to skip
			// recalcThreadMetadata, leaving threads.last_post_at /
			// last_poster pointing at the now-deleted post. The forum
			// recalc then read stale per-thread aggregates and could end
			// up advertising a deleted poster as the forum's last poster.
			const token = await createJwtForRole(0, 10);
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, thread_id, forum_id, author_id, is_first FROM posts": {
						id: 9,
						thread_id: 42,
						forum_id: 7,
						author_id: 10,
						is_first: 0,
					},
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
			const request = new Request("https://api.example.com/api/v1/me/posts/9", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyPost(request, env);
			expect(response.status).toBe(200);

			// Thread recalc query must have run, parameterized with the
			// post's thread_id, BEFORE the forum recalc query.
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
	});

	// ─── deleteMyThread ─────────────────────────────────────────────

	describe("deleteMyThread", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/me/threads/1", {
				method: "DELETE",
			});
			const response = await deleteMyThread(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject invalid thread ID", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/threads/abc", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyThread(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 if thread not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, forum_id, author_id, replies FROM threads": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/threads/99", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyThread(request, env);
			expect(response.status).toBe(404);
		});

		it("should forbid deleting another user's thread", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, forum_id, author_id, replies FROM threads": {
						id: 1,
						forum_id: 1,
						author_id: 99,
						replies: 5,
					},
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/threads/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyThread(request, env);
			expect(response.status).toBe(403);
		});

		it("should delete own thread successfully", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, forum_id, author_id, replies FROM threads": {
						id: 3,
						forum_id: 1,
						author_id: 10,
						replies: 2,
					},
					"SELECT id FROM threads WHERE forum_id": { id: 5 },
				},
				allResults: {
					"SELECT author_id FROM posts WHERE thread_id": [
						{ author_id: 10 },
						{ author_id: 20 },
						{ author_id: 10 },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/threads/3", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			});
			const response = await deleteMyThread(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { deleted: boolean; id: number } };
			expect(body.data.deleted).toBe(true);
			expect(body.data.id).toBe(3);
		});
	});

	// ─── editMyPost ─────────────────────────────────────────────────

	describe("editMyPost", () => {
		it("should require authentication", async () => {
			const env = makeEnv();
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "PATCH",
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(401);
		});

		it("should reject invalid post ID", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/abc", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "updated" }),
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject invalid JSON body", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: "not json",
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(400);
		});

		it("should reject empty content", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "   " }),
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(400);
		});

		it("should return 404 if post not found", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, author_id FROM posts WHERE id": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/99", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "updated" }),
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(404);
		});

		it("should forbid editing another user's post", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, author_id FROM posts WHERE id": { id: 1, author_id: 99 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "updated" }),
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(403);
		});

		it("should update own post content", async () => {
			const token = await createJwtForRole(0, 10);
			const { db } = createMockDb({
				firstResults: {
					"SELECT role, status": { role: 0, status: 0, email_verified_at: 1700000000 },
					"SELECT id, author_id FROM posts WHERE id": { id: 1, author_id: 10 },
				},
			});
			const env = makeEnv({ DB: db });
			const request = new Request("https://api.example.com/api/v1/me/posts/1", {
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content: "updated content" }),
			});
			const response = await editMyPost(request, env);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: { id: number; updated: boolean } };
			expect(body.data.updated).toBe(true);
			expect(body.data.id).toBe(1);
		});
	});
});

describe("user-content handlers — §5.4 email-verification gate", () => {
	it("deleteMyPost: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await deleteMyPost(
			new Request("https://example.com/api/v1/me/posts/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("deleteMyThread: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await deleteMyThread(
			new Request("https://example.com/api/v1/me/threads/1", {
				method: "DELETE",
				headers: { Authorization: `Bearer ${token}` },
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});

	it("editMyPost: unverified user → 403 EMAIL_NOT_VERIFIED payload, no business SQL", async () => {
		const { env, calls } = makeUnverifiedEnv(1);
		const token = await unverifiedUserJwt(1);
		const response = await editMyPost(
			new Request("https://example.com/api/v1/me/posts/1", {
				method: "PATCH",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ content: "x" }),
			}),
			env,
		);
		await expectEmailNotVerifiedResponse(response);
		expect(calls.length).toBe(1);
		expect(calls[0].sql).toContain("SELECT role, status, email_verified_at FROM users");
	});
});
