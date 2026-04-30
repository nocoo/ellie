import { describe, expect, it } from "vitest";
import { deleteMyPost, deleteMyThread, editMyPost } from "../../../src/handlers/user-content";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";

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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
					"SELECT role, status FROM users WHERE id": { role: 0, status: 0 },
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
