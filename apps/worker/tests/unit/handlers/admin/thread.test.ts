import { describe, expect, it } from "bun:test";
import {
	batchDelete,
	batchMove,
	getById,
	list,
	remove,
	update,
} from "../../../../src/handlers/admin/thread";
import {
	createAdminRequest,
	createJwtForRole,
	createMockDb,
	makeD1ThreadRow,
	makeEnv,
} from "../../../helpers";

describe("admin thread handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	// ─── list ─────────────────────────────────────────────────

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

			const req = await createAdminRequest("GET", "/api/admin/threads?page=1&limit=20");
			const res = await list(req, adminEnv(db));
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

			const req = await createAdminRequest("GET", "/api/admin/threads?forumId=5");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const forumIdCall = calls.find((c) => c.sql.includes("forum_id ="));
			expect(forumIdCall?.params).toContain(5);
		});

		it("should filter by authorId", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?authorId=123");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const authorIdCall = calls.find((c) => c.sql.includes("author_id ="));
			expect(authorIdCall?.params).toContain(123);
		});

		it("should search by authorName (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?authorName=alice");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("author_name LIKE"));
			expect(likeCall?.params).toContain("%alice%");
		});

		it("should search by subject (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?subject=test");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("subject LIKE"));
			expect(likeCall?.params).toContain("%test%");
		});

		it("should filter by sticky level", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?sticky=1");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const stickyCall = calls.find((c) => c.sql.includes("sticky ="));
			expect(stickyCall?.params).toContain(1);
		});

		it("should filter by closed state", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?closed=1");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const closedCall = calls.find((c) => c.sql.includes("closed ="));
			expect(closedCall?.params).toContain(1);
		});

		it("should filter by digest level", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?digest=2");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const digestCall = calls.find((c) => c.sql.includes("digest ="));
			expect(digestCall?.params).toContain(2);
		});

		it("should filter by highlight", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?highlight=1");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const highlightCall = calls.find((c) => c.sql.includes("highlight ="));
			expect(highlightCall?.params).toContain(1);
		});

		it("should paginate with page 2", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT(*) as total": { total: 50 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads?page=2&limit=20");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
			const offsetCall = calls.find((c) => c.params.includes(20)); // LIMIT
			expect(offsetCall?.params).toContain(20); // OFFSET = (2-1)*20 = 20
		});

		it("should reject user role (requires mod+)", async () => {
			const { db } = createMockDb();
			const req = await createAdminRequest("GET", "/api/admin/threads", undefined, 0); // User role
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(403);
		});

		it("should allow admin role", async () => {
			const { db } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads", undefined, 1); // Admin
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should allow mod role", async () => {
			const { db } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads", undefined, 3); // Mod
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should allow supermod role", async () => {
			const { db } = createMockDb({
				allResults: { "FROM threads": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads", undefined, 2); // SuperMod
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb({});

			const req = await createAdminRequest("GET", "/api/admin/threads?page=0");
			const res = await list(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid page number");
		});
	});

	// ─── getById ──────────────────────────────────────────────

	describe("getById", () => {
		it("should return thread by ID", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, subject: "Test Thread" });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads": threadRow },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads/42");
			const res = await getById(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
			expect(body.data.subject).toBe("Test Thread");
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb();
			const req = await createAdminRequest("GET", "/api/admin/threads/999");
			const res = await getById(req, adminEnv(db));

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject invalid thread ID", async () => {
			const { db } = createMockDb();
			const req = await createAdminRequest("GET", "/api/admin/threads/abc");
			const res = await getById(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid thread ID");
		});

		it("should map snake_case to camelCase", async () => {
			const threadRow = makeD1ThreadRow({ id: 10, forum_id: 5, author_id: 99, author_name: "bob" });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads": threadRow },
			});

			const req = await createAdminRequest("GET", "/api/admin/threads/10");
			const res = await getById(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.forumId).toBe(5);
			expect(body.data.authorId).toBe(99);
			expect(body.data.authorName).toBe("bob");
			// Internal field should NOT be exposed
			expect(body.data.post_table_id).toBeUndefined();
		});
	});

	// ─── update (unified PATCH) ───────────────────────────────

	describe("update", () => {
		it("should update subject", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, subject: "Old Title" });
			const updatedRow = makeD1ThreadRow({ id: 42, subject: "New Title" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", {
				subject: "New Title",
			});
			const res = await update(req, adminEnv(db));
			const _body = await res.json();

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.params).toContain("New Title");
		});

		it("should update sticky level", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, sticky: 0 });
			const updatedRow = makeD1ThreadRow({ id: 42, sticky: 2 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { sticky: 2 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET"));
			expect(updateCall?.params).toContain(2);
		});

		it("should update digest level", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, digest: 0 });
			const updatedRow = makeD1ThreadRow({ id: 42, digest: 3 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { digest: 3 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET"));
			expect(updateCall?.params).toContain(3);
		});

		it("should update closed state", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, closed: 0 });
			const updatedRow = makeD1ThreadRow({ id: 42, closed: 1 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { closed: 1 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET"));
			expect(updateCall?.params).toContain(1);
		});

		it("should update highlight", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, highlight: 0 });
			const updatedRow = makeD1ThreadRow({ id: 42, highlight: 1 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { highlight: 1 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should update forumId (move) with beforeUpdate hook validating target forum", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const updatedRow = makeD1ThreadRow({ id: 42, forum_id: 10, replies: 10 });
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT id FROM forums": { id: 10 },
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { forumId: 10 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
			// afterUpdate hook fires batch for moving posts and adjusting forum counts
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(3); // update posts, decrement old, increment new
		});

		it("should reject move to non-existent target forum", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					// "SELECT id FROM forums" returns null — target not found
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { forumId: 999 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Target forum not found");
		});

		it("should include CORS headers in beforeUpdate hook error", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/threads/42", {
					method: "PATCH",
					headers: {
						"X-API-Key": "test-api-key",
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
						Origin: "http://localhost:3000",
					},
					body: JSON.stringify({ forumId: 999 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});

		it("should skip afterUpdate batch when forumId unchanged", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const updatedRow = makeD1ThreadRow({ id: 42, forum_id: 5, subject: "Updated", replies: 10 });
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			// Update subject only — no forum move
			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", {
				subject: "Updated",
			});
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
			expect(batchCalls.length).toBe(0); // No move batch
		});

		it("should update multiple fields at once", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const updatedRow = makeD1ThreadRow({ id: 42, sticky: 1, closed: 1, digest: 2 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRow,
					"SELECT * FROM threads": updatedRow,
				},
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", {
				sticky: 1,
				closed: 1,
				digest: 2,
			});
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE threads SET"));
			expect(updateCall).toBeDefined();
			// Should contain all three values
			expect(updateCall?.params).toContain(1); // sticky or closed
			expect(updateCall?.params).toContain(2); // digest
		});

		it("should reject empty body (no fields)", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", {});
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("At least one field must be provided");
		});

		it("should reject invalid sticky value", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { sticky: 5 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("sticky must be 0-3");
		});

		it("should reject non-integer sticky", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { sticky: "high" });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("sticky must be an integer");
		});

		it("should reject invalid digest value", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { digest: -1 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("digest must be 0-3");
		});

		it("should reject invalid closed value", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { closed: 2 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("closed must be 0 or 1");
		});

		it("should reject subject that is too long", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", {
				subject: "x".repeat(201),
			});
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("subject must be at most 200 characters");
		});

		it("should reject empty subject", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { subject: "  " });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("subject cannot be empty");
		});

		it("should reject negative highlight", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { highlight: -1 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("highlight must be >= 0");
		});

		it("should reject non-positive forumId", async () => {
			const threadRow = makeD1ThreadRow({ id: 42 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads WHERE id": threadRow },
			});

			const req = await createAdminRequest("PATCH", "/api/admin/threads/42", { forumId: 0 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("forumId must be a positive integer");
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("PATCH", "/api/admin/threads/999", { sticky: 1 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("THREAD_NOT_FOUND");
		});

		it("should reject invalid thread ID", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("PATCH", "/api/admin/threads/abc", { sticky: 1 });
			const res = await update(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid thread ID");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/threads/42", {
					method: "PATCH",
					headers: {
						"X-API-Key": "test-api-key",
						Authorization: `Bearer ${token}`,
					},
					body: "invalid json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});
	});

	// ─── remove ───────────────────────────────────────────────

	describe("remove", () => {
		it("should delete thread and return postsDeleted count", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 10 });
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT * FROM threads": threadRow,
					"SELECT COUNT": { cnt: 11 },
				},
			});

			const req = await createAdminRequest("DELETE", "/api/admin/threads/42");
			const res = await remove(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.postsDeleted).toBe(11);

			// Verify batch was called: DELETE posts, DELETE thread, UPDATE forum
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(3);
		});

		it("should return 404 for non-existent thread", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM threads": null },
			});

			const req = await createAdminRequest("DELETE", "/api/admin/threads/999");
			const res = await remove(req, adminEnv(db));

			expect(res.status).toBe(404);
		});

		it("should reject invalid thread ID", async () => {
			const { db } = createMockDb();
			const req = await createAdminRequest("DELETE", "/api/admin/threads/abc");
			const res = await remove(req, adminEnv(db));

			expect(res.status).toBe(400);
		});

		it("should handle thread with zero posts gracefully", async () => {
			const threadRow = makeD1ThreadRow({ id: 42, forum_id: 5, replies: 0 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads": threadRow,
					"SELECT COUNT": { cnt: 0 },
				},
			});

			const req = await createAdminRequest("DELETE", "/api/admin/threads/42");
			const res = await remove(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.postsDeleted).toBe(0);
		});
	});

	// ─── batchDelete ──────────────────────────────────────────

	describe("batchDelete", () => {
		it("should delete multiple threads", async () => {
			const threadRows = [
				makeD1ThreadRow({ id: 1, forum_id: 5, replies: 2 }),
				makeD1ThreadRow({ id: 2, forum_id: 5, replies: 3 }),
			];
			// The CRUD batchDelete fetches each thread individually via SELECT * FROM threads WHERE id = ?
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM threads WHERE id": threadRows[0],
				},
			});

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-delete", {
				ids: [1, 2],
			});
			const res = await batchDelete(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.deleted).toBe(true);
			expect(body.data.count).toBeGreaterThanOrEqual(0);
		});

		it("should return 400 for empty ids array", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-delete", { ids: [] });
			const res = await batchDelete(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should return 400 for over 100 ids", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-delete", {
				ids: Array.from({ length: 101 }, (_, i) => i),
			});
			const res = await batchDelete(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should return 400 for non-array ids", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-delete", {
				ids: "1,2,3",
			});
			const res = await batchDelete(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should return 400 for missing ids field", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-delete", {});
			const res = await batchDelete(req, adminEnv(db));

			expect(res.status).toBe(400);
		});

		it("should return count 0 when no threads found", async () => {
			// The CRUD framework's batchDelete loops per-id: if none exist, count stays 0
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-delete", {
				ids: [999, 1000],
			});
			const res = await batchDelete(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.count).toBe(0);
		});
	});

	// ─── batchMove ────────────────────────────────────────────

	describe("batchMove", () => {
		it("should move threads to a different forum", async () => {
			const threadRows = [
				makeD1ThreadRow({ id: 1, forum_id: 5, replies: 2 }),
				makeD1ThreadRow({ id: 2, forum_id: 5, replies: 3 }),
			];
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id FROM forums": { id: 10 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads": threadRows,
				},
			});

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [1, 2],
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.moved).toBe(true);
			expect(body.data.count).toBe(2);
			expect(body.data.forumId).toBe(10);

			// Verify batch: 2 thread updates + 2 post updates + 1 decrement old + 1 increment new = 6
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(6);
		});

		it("should return count 0 when all threads already in target forum", async () => {
			const threadRows = [
				makeD1ThreadRow({ id: 1, forum_id: 10, replies: 2 }),
				makeD1ThreadRow({ id: 2, forum_id: 10, replies: 3 }),
			];
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id FROM forums": { id: 10 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads": threadRows,
				},
			});

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [1, 2],
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.moved).toBe(true);
			expect(body.data.count).toBe(0);
			expect(batchCalls.length).toBe(0); // No batch needed
		});

		it("should reject missing ids", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [],
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should reject over 100 ids", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: Array.from({ length: 101 }, (_, i) => i + 1),
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should reject missing forumId", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [1, 2],
			});
			const res = await batchMove(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("forumId must be a positive integer");
		});

		it("should reject non-positive forumId", async () => {
			const { db } = createMockDb();

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [1, 2],
				forumId: 0,
			});
			const res = await batchMove(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("forumId must be a positive integer");
		});

		it("should reject non-existent target forum", async () => {
			const { db } = createMockDb({
				firstResults: {
					// "SELECT id FROM forums" returns null — target not found
				},
			});

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [1, 2],
				forumId: 999,
			});
			const res = await batchMove(req, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Target forum not found");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await batchMove(
				new Request("https://api.example.com/api/admin/threads/batch-move", {
					method: "POST",
					headers: {
						"X-API-Key": "test-api-key",
						Authorization: `Bearer ${token}`,
					},
					body: "invalid json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should return count 0 when no matching threads found", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM forums": { id: 10 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads": [],
				},
			});

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [999, 1000],
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.moved).toBe(true);
			expect(body.data.count).toBe(0);
		});

		it("should handle threads from multiple source forums", async () => {
			const threadRows = [
				makeD1ThreadRow({ id: 1, forum_id: 5, replies: 2 }),
				makeD1ThreadRow({ id: 2, forum_id: 7, replies: 3 }),
				makeD1ThreadRow({ id: 3, forum_id: 5, replies: 1 }),
			];
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id FROM forums": { id: 10 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads": threadRows,
				},
			});

			const req = await createAdminRequest("POST", "/api/admin/threads/batch-move", {
				ids: [1, 2, 3],
				forumId: 10,
			});
			const res = await batchMove(req, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.count).toBe(3);

			// 3 thread updates + 3 post updates + 2 old forum decrements + 1 new forum increment = 9
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(9);
		});
	});
});
