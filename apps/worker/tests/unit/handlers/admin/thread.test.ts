import { describe, expect, it } from "bun:test";
import { StickyLevel } from "@ellie/types";
import {
	batchDelete,
	getById,
	list,
	move,
	remove,
	setClosed,
	setDigest,
	setSticky,
} from "../../../../src/handlers/admin/thread";
import { createJwtForRole, createMockDb, makeD1ThreadRow, makeEnv } from "../../../helpers";

describe("admin thread handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	describe("list", () => {
		it("should list threads with pagination", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM threads": [makeD1ThreadRow({ id: 1 }), makeD1ThreadRow({ id: 2 })],
				},
				firstResults: {
					"SELECT COUNT": { total: 2 },
				},
			});

			const token = await createJwtForRole(1); // Admin
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?page=1&limit=20", {
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

		it("should filter by forumId", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?forumId=5", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const forumIdCall = calls.find((c) => c.sql.includes("forum_id ="));
			expect(forumIdCall?.params).toContain(5);
		});

		it("should filter by authorId", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?authorId=123", {
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
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?authorName=alice", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("author_name LIKE"));
			expect(likeCall?.params).toContain("%alice%");
		});

		it("should search by subject (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?subject=test", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("subject LIKE"));
			expect(likeCall?.params).toContain("%test%");
		});

		it("should filter by sticky level", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?sticky=1", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const stickyCall = calls.find((c) => c.sql.includes("sticky ="));
			expect(stickyCall?.params).toContain(1);
		});

		it("should filter by closed state", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?closed=1", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const closedCall = calls.find((c) => c.sql.includes("closed ="));
			expect(closedCall?.params).toContain(1);
		});

		it("should paginate with page 2", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT(*) as total": { total: 50 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/threads?page=2&limit=20", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const offsetCall = calls.find((c) => c.params.includes(20)); // LIMIT
			expect(offsetCall?.params).toContain(20); // OFFSET = (2-1)*20 = 20
		});

		it("should reject user role (requires mod+)", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(0); // User
			const res = await list(
				new Request("https://api.example.com/api/admin/threads", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(403);
		});

		it("should allow mod role", async () => {
			const { db } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(3); // Mod
			const res = await list(
				new Request("https://api.example.com/api/admin/threads", {
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
				new Request("https://api.example.com/api/admin/threads?page=0", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid page number");
		});
	});

	describe("getById", () => {
		it("should return thread by ID", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, subject: "Test Thread" });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads": threadRow },
			});

			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/threads/42", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
			expect(body.data.subject).toBe("Test Thread");
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/threads/999", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject invalid thread ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/threads/abc", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid thread ID");
		});
	});

	describe("remove", () => {
		it("should delete thread and cascade posts, update forum counts", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const { db, batchCalls } = createMockDb({
				firstResults: { "SELECT * FROM threads": threadRow },
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/threads/42", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.postsDeleted).toBe(11); // 10 replies + 1

			// Verify batch was called
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(3); // DELETE posts, DELETE thread, UPDATE forum
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads": null },
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/threads/999", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should reject invalid thread ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/threads/abc", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});
	});

	describe("setSticky", () => {
		it("should set sticky level", async () => {
			const { db, calls } = createMockDb({
				runResults: { "UPDATE threads SET sticky": { success: true, meta: { changes: 1 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setSticky(
				new Request("https://api.example.com/api/admin/threads/42/sticky", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: StickyLevel.Forum }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.sticky).toBe(StickyLevel.Forum);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET sticky"));
			expect(updateCall?.params).toContain(1);
		});

		it("should reject invalid level", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await setSticky(
				new Request("https://api.example.com/api/admin/threads/42/sticky", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: 5 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("level must be 0-3");
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb({
				runResults: { "UPDATE threads SET sticky": { success: true, meta: { changes: 0 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setSticky(
				new Request("https://api.example.com/api/admin/threads/999/sticky", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: 1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should reject invalid thread ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await setSticky(
				new Request("https://api.example.com/api/admin/threads/abc/sticky", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: 1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});
	});

	describe("setDigest", () => {
		it("should set digest level", async () => {
			const { db } = createMockDb({
				runResults: { "UPDATE threads": { success: true, meta: { changes: 1 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setDigest(
				new Request("https://api.example.com/api/admin/threads/42/digest", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: 2 }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.digest).toBe(2);
		});

		it("should reject invalid level", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await setDigest(
				new Request("https://api.example.com/api/admin/threads/42/digest", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: -1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb({
				runResults: { "UPDATE threads": { success: true, meta: { changes: 0 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setDigest(
				new Request("https://api.example.com/api/admin/threads/999/digest", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ level: 1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await setDigest(
				new Request("https://api.example.com/api/admin/threads/42/digest", {
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

	describe("setClosed", () => {
		it("should close thread", async () => {
			const { db } = createMockDb({
				runResults: { "UPDATE threads": { success: true, meta: { changes: 1 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setClosed(
				new Request("https://api.example.com/api/admin/threads/42/close", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ closed: 1 }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.closed).toBe(1);
		});

		it("should open thread", async () => {
			const { db } = createMockDb({
				runResults: { "UPDATE threads": { success: true, meta: { changes: 1 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setClosed(
				new Request("https://api.example.com/api/admin/threads/42/close", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ closed: 0 }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.closed).toBe(0);
		});

		it("should handle boolean closed=true", async () => {
			const { db, calls } = createMockDb({
				runResults: { "UPDATE threads": { success: true, meta: { changes: 1 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setClosed(
				new Request("https://api.example.com/api/admin/threads/42/close", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ closed: true }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET closed"));
			expect(updateCall?.params.at(-2)).toBe(1); // closed value
		});

		it("should reject invalid closed value", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await setClosed(
				new Request("https://api.example.com/api/admin/threads/42/close", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ closed: "yes" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb({
				runResults: { "UPDATE threads": { success: true, meta: { changes: 0 } } },
			});

			const token = await createJwtForRole(1);
			const res = await setClosed(
				new Request("https://api.example.com/api/admin/threads/999/close", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ closed: 1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await setClosed(
				new Request("https://api.example.com/api/admin/threads/42/close", {
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

	describe("move", () => {
		it("should move thread to different forum", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT id FROM forums": { id: 10 }, // target forum
				},
			});

			const token = await createJwtForRole(1);
			const res = await move(
				new Request("https://api.example.com/api/admin/threads/42/move", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 10 }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.moved).toBe(true);
			expect(body.data.fromForumId).toBe(5);
			expect(body.data.toForumId).toBe(10);

			// Verify batch: update thread, update posts, decrement source forum, increment target forum
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(4);
		});

		it("should reject moving to same forum", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT id FROM forums WHERE id": { id: 5 },
				},
			});

			const token = await createJwtForRole(1);
			const res = await move(
				new Request("https://api.example.com/api/admin/threads/42/move", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 5 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Thread is already in this forum");
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads": null },
			});

			const token = await createJwtForRole(1);
			const res = await move(
				new Request("https://api.example.com/api/admin/threads/999/move", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 10 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should return 400 for non-existent target forum", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT id FROM forums WHERE id": null, // target not found
				},
			});

			const token = await createJwtForRole(1);
			const res = await move(
				new Request("https://api.example.com/api/admin/threads/42/move", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ forumId: 999 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Target forum not found");
		});

		it("should reject missing forumId", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await move(
				new Request("https://api.example.com/api/admin/threads/42/move", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("forumId is required");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await move(
				new Request("https://api.example.com/api/admin/threads/42/move", {
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

	describe("batchDelete", () => {
		it("should delete multiple threads", async () => {
			const threadRows = [
				makeD1ThreadRow({ id: 1, forum_id: 5, replies: 2 }),
				makeD1ThreadRow({ id: 2, forum_id: 5, replies: 3 }),
				makeD1ThreadRow({ id: 3, forum_id: 10, replies: 1 }),
			];
			const { db, calls, batchCalls } = createMockDb({
				allResults: { "SELECT id, forum_id, replies FROM threads": threadRows },
			});

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/threads/batch-delete", {
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

			// Verify SELECT with IN clause
			const selectCall = calls.find((c) => c.sql.includes("WHERE id IN"));
			expect(selectCall).toBeDefined();

			// Verify batch calls
			expect(batchCalls.length).toBe(1);
			// 3 DELETE posts + 3 DELETE threads + 2 UPDATE forums = 8
			expect(batchCalls[0].length).toBe(8);
		});

		it("should return 400 for empty ids array", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/threads/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [] }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids cannot be empty");
		});

		it("should return 400 for over 100 ids", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/threads/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: Array.from({ length: 101 }, (_, i) => i) }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should return 400 for non-array ids", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/threads/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: "1,2,3" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be an array");
		});

		it("should return 400 for non-number ids", async () => {
			const { db } = createMockDb();

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/threads/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [1, 2, "abc"] }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("All ids must be numbers");
		});

		it("should return 404 when no threads found", async () => {
			const { db } = createMockDb({
				allResults: { "SELECT id, forum_id, replies FROM threads": [] },
			});

			const token = await createJwtForRole(1);
			const res = await batchDelete(
				new Request("https://api.example.com/api/admin/threads/batch-delete", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ ids: [999, 1000] }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});
	});
});
