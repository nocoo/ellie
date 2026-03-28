import { describe, expect, it } from "bun:test";
import { batchDelete, getById, list, remove, update } from "../../../../src/handlers/admin/post";
import { createJwtForRole, createMockDb, makeD1PostRow, makeEnv } from "../../../helpers";

describe("admin post handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	// ─── list ─────────────────────────────────────────────────────

	describe("list", () => {
		it("should list posts with pagination", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM posts": [makeD1PostRow({ id: 1 }), makeD1PostRow({ id: 2 })],
				},
				firstResults: { "SELECT COUNT": { total: 2 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?page=1&limit=20", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(2);
			expect(body.meta.total).toBe(2);
			expect(body.meta.page).toBe(1);
			expect(body.meta.pages).toBe(1);
		});

		it("should filter by threadId", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM posts": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?threadId=5", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const threadIdCall = calls.find((c) => c.sql.includes("thread_id ="));
			expect(threadIdCall?.params).toContain(5);
		});

		it("should filter by authorId", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM posts": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?authorId=123", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const authorIdCall = calls.find((c) => c.sql.includes("author_id ="));
			expect(authorIdCall?.params).toContain(123);
		});

		it("should search by authorName (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM posts": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?authorName=alice", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("author_name LIKE"));
			expect(likeCall?.params).toContain("%alice%");
		});

		it("should search by content (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM posts": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?content=test", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("content LIKE"));
			expect(likeCall?.params).toContain("%test%");
		});

		it("should paginate with page 2", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM posts": [] },
				firstResults: { "SELECT COUNT(*) as total": { total: 50 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?page=2&limit=20", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const offsetCall = calls.find((c) => c.params.includes(20)); // OFFSET = (2-1)*20
			expect(offsetCall?.params).toContain(20);
		});

		it("should reject user role (requires mod+)", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(0); // User
			const res = await list(
				new Request("https://api.example.com/api/admin/posts", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(403);
		});

		it("should allow mod role", async () => {
			const { db } = createMockDb({
				allResults: { "FROM posts": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(3); // Mod
			const res = await list(
				new Request("https://api.example.com/api/admin/posts", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb({});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/posts?page=0", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid page number");
		});
	});

	// ─── getById ──────────────────────────────────────────────────

	describe("getById", () => {
		it("should return post by ID", async () => {
			const postRow = makeD1PostRow({ id: 42, content: "<p>Hello</p>" });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts": postRow },
			});

			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/posts/42", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
			expect(body.data.content).toBe("<p>Hello</p>");
		});

		it("should return 404 for non-existent post", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/posts/999", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("POST_NOT_FOUND");
		});

		it("should reject invalid post ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/posts/abc", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid post ID");
		});
	});

	// ─── update ───────────────────────────────────────────────────

	describe("update", () => {
		it("should update post content", async () => {
			const postRow = makeD1PostRow({ id: 42, content: "<p>Old content</p>" });
			const updatedRow = makeD1PostRow({ id: 42, content: "<p>New content</p>" });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM posts": postRow, // fetchRowFull (existing check)
					"SELECT * FROM posts WHERE id": updatedRow, // fetchRow after update
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ content: "<p>New content</p>" }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
		});

		it("should reject empty content", async () => {
			const postRow = makeD1PostRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts": postRow },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ content: "" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("content must be a non-empty string");
		});

		it("should reject non-string content", async () => {
			const postRow = makeD1PostRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts": postRow },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ content: 123 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("content must be a non-empty string");
		});

		it("should reject empty body (no fields)", async () => {
			const postRow = makeD1PostRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts": postRow },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("At least one field must be provided");
		});

		it("should return 404 for non-existent post", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts": null },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/999", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ content: "<p>Updated</p>" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("POST_NOT_FOUND");
		});

		it("should reject invalid post ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/abc", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ content: "<p>Updated</p>" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid post ID");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/posts/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: "invalid json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});
	});

	// ─── remove ───────────────────────────────────────────────────

	describe("remove", () => {
		it("should delete non-first post and decrement counts", async () => {
			const postRow = makeD1PostRow({ id: 42, thread_id: 5, forum_id: 10, is_first: 0 });
			const { db, batchCalls } = createMockDb({
				firstResults: { "SELECT * FROM posts WHERE id": postRow },
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/posts/42", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.id).toBe(42);

			// afterDelete hook calls env.DB.batch with thread + forum updates
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(2); // UPDATE thread, UPDATE forum
		});

		it("should refuse to delete first post", async () => {
			const postRow = makeD1PostRow({ id: 1, is_first: 1 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts WHERE id": postRow },
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/posts/1", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("CANNOT_DELETE_FIRST_POST");
			expect(body.error.details.message).toBe(
				"Cannot delete the first post — delete the thread instead",
			);
		});

		it("should return 404 for non-existent post", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM posts WHERE id": null },
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/posts/999", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("POST_NOT_FOUND");
		});

		it("should reject invalid post ID", async () => {
			const { db } = createMockDb({});
			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/posts/abc", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid post ID");
		});
	});

	// ─── batchDelete ──────────────────────────────────────────────

	describe("batchDelete", () => {
		it("should delete multiple posts", async () => {
			const postRows = [
				makeD1PostRow({ id: 1, thread_id: 5, forum_id: 10, is_first: 0 }),
				makeD1PostRow({ id: 2, thread_id: 5, forum_id: 10, is_first: 0 }),
				makeD1PostRow({ id: 3, thread_id: 6, forum_id: 10, is_first: 0 }),
			];
			const { db, calls, batchCalls } = createMockDb({
				allResults: { "SELECT id, thread_id, forum_id, is_first FROM posts": postRows },
			});

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [1, 2, 3] }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.count).toBe(3);
			expect(body.data.skipped).toEqual([]);

			// Verify SELECT with IN clause
			const selectCall = calls.find((c) => c.sql.includes("WHERE id IN"));
			expect(selectCall).toBeDefined();

			// Verify batch: 3 DELETE posts + 2 UPDATE threads + 1 UPDATE forum = 6
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(6);
		});

		it("should skip first posts and report them", async () => {
			const postRows = [
				makeD1PostRow({ id: 1, thread_id: 5, forum_id: 10, is_first: 1 }), // first post
				makeD1PostRow({ id: 2, thread_id: 5, forum_id: 10, is_first: 0 }),
			];
			const { db } = createMockDb({
				allResults: { "SELECT id, thread_id, forum_id, is_first FROM posts": postRows },
			});

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [1, 2] }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.count).toBe(1);
			expect(body.data.skipped).toEqual([1]);
		});

		it("should handle when all posts are first posts (count=0, skipped=all)", async () => {
			const postRows = [
				makeD1PostRow({ id: 1, is_first: 1 }),
				makeD1PostRow({ id: 2, is_first: 1 }),
			];
			const { db } = createMockDb({
				allResults: { "SELECT id, thread_id, forum_id, is_first FROM posts": postRows },
			});

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [1, 2] }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.count).toBe(0);
			expect(body.data.skipped).toEqual([1, 2]);
		});

		it("should return 400 for empty ids array", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [] }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should return 400 for non-array ids", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: "1,2,3" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should return 400 for over 100 ids", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: Array.from({ length: 101 }, (_, i) => i + 1) }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should silently filter non-number ids and proceed with valid ones", async () => {
			const postRows = [
				makeD1PostRow({ id: 1, thread_id: 5, forum_id: 10, is_first: 0 }),
				makeD1PostRow({ id: 2, thread_id: 5, forum_id: 10, is_first: 0 }),
			];
			const { db } = createMockDb({
				allResults: { "SELECT id, thread_id, forum_id, is_first FROM posts": postRows },
			});

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [1, 2, "abc"] }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			// "abc" is silently filtered out; [1, 2] proceed normally
			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.count).toBe(2);
		});

		it("should return 400 when all ids are non-numeric after filtering", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: ["abc", "def"] }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must contain valid numbers");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/posts/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: "invalid json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});
	});
});
