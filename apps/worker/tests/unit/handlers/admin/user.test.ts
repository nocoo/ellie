import { describe, expect, it } from "bun:test";
import {
	ban,
	batchFetch,
	batchRecalcCounters,
	batchRole,
	batchStatus,
	getById,
	list,
	listStaff,
	nuke,
	recalcCounters,
	update,
} from "../../../../src/handlers/admin/user";
import { createAdminRequest, createMockDb, makeD1UserRow, makeEnv } from "../../../helpers";

describe("admin user handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	// ─── list ─────────────────────────────────────────────────

	describe("list", () => {
		it("should list users with pagination", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users": [makeD1UserRow({ id: 1 }), makeD1UserRow({ id: 2 })],
				},
				firstResults: { "SELECT COUNT": { total: 2 } },
			});

			const res = await list(
				createAdminRequest("GET", "/api/admin/users?page=1&limit=20"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(2);
			expect(body.meta.total).toBe(2);
		});

		it("should filter by username (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const res = await list(
				createAdminRequest("GET", "/api/admin/users?username=alice"),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("username LIKE"));
			expect(likeCall?.params).toContain("%alice%");
		});

		it("should filter by email (LIKE)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const res = await list(
				createAdminRequest("GET", "/api/admin/users?email=test@example.com"),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const likeCall = calls.find((c) => c.sql.includes("email LIKE"));
			expect(likeCall?.params).toContain("%test@example.com%");
		});

		it("should filter by status", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const res = await list(createAdminRequest("GET", "/api/admin/users?status=-1"), adminEnv(db));

			expect(res.status).toBe(200);
			const statusCall = calls.find((c) => c.sql.includes("status ="));
			expect(statusCall?.params).toContain(-1);
		});

		it("should filter by role", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const res = await list(createAdminRequest("GET", "/api/admin/users?role=3"), adminEnv(db));

			expect(res.status).toBe(200);
			const roleCall = calls.find((c) => c.sql.includes("role ="));
			expect(roleCall?.params).toContain(3);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb();
			const res = await list(createAdminRequest("GET", "/api/admin/users?page=0"), adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid page number");
		});
	});

	// ─── getById ──────────────────────────────────────────────

	describe("getById", () => {
		it("should return user by ID", async () => {
			const { db } = createMockDb({
				firstResults: { "FROM users WHERE id": makeD1UserRow({ id: 42 }) },
			});

			const res = await getById(createAdminRequest("GET", "/api/admin/users/42"), adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "FROM users WHERE id": null },
			});

			const res = await getById(createAdminRequest("GET", "/api/admin/users/999"), adminEnv(db));

			expect(res.status).toBe(404);
		});

		it("should never expose password fields", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "FROM users WHERE id": makeD1UserRow({ id: 1 }) },
			});

			await getById(createAdminRequest("GET", "/api/admin/users/1"), adminEnv(db));

			// Verify SQL uses explicit columns, not SELECT *
			const selectCall = calls.find((c) => c.sql.includes("FROM users WHERE id"));
			expect(selectCall?.sql).not.toContain("SELECT *");
			expect(selectCall?.sql).not.toContain("password");
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("GET", "/api/admin/users/abc");

			const res = await getById(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid user ID");
		});
	});

	// ─── update ───────────────────────────────────────────────

	describe("update", () => {
		it("should update username", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id FROM users WHERE username": null,
					"SELECT id, username": makeD1UserRow({ id: 42, username: "newname" }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				username: "newname",
			});
			const res = await update(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
		});

		it("should update email", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, email: "new@example.com" }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				email: "new@example.com",
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should update credits", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, credits: 500 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				credits: 500,
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should update status", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, status: -1 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				status: -1,
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should update role", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, role: 2 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				role: 2,
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should reject USERNAME_TAKEN", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id FROM users WHERE username": { id: 99 },
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				username: "taken",
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe("USERNAME_TAKEN");
		});

		it("should include CORS headers in beforeUpdate hook error", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id FROM users WHERE username": { id: 99 },
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/users/42", {
					method: "PATCH",
					headers: {
						"X-API-Key": "test-api-key",
						"Content-Type": "application/json",
						Origin: "http://localhost:3000",
					},
					body: JSON.stringify({ username: "taken" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(409);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});

		it("should reject empty body (no fields)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("At least one field must be provided");
		});

		it("should reject invalid status value", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				status: 5,
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("status must be 0, -1, or -2");
		});

		it("should reject invalid role value", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				role: 5,
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("role must be 0, 1, 2, or 3");
		});

		it("should reject invalid email format", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				email: "notanemail",
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("email must contain @");
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": null,
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/999", {
				username: "test",
			});
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(404);
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("PATCH", "/api/admin/users/abc", {
				username: "test",
			});

			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
		});
	});

	// ─── ban ──────────────────────────────────────────────────

	describe("ban", () => {
		it("should simple ban without content deletion", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
			});

			const res = await ban(
				createAdminRequest("POST", "/api/admin/users/42/ban", {}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.banned).toBe(true);
			expect(body.data.contentDeleted).toBe(false);
		});

		it("should ban with content deletion", async () => {
			const threadRows = [
				{ id: 10, forum_id: 1, replies: 3 },
				{ id: 11, forum_id: 2, replies: 1 },
			];
			const standalonePostRows = [{ forum_id: 1, cnt: 2 }];
			const standaloneThreadRows = [{ thread_id: 20, cnt: 2 }];

			const { db, batchCalls } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": threadRows,
					"SELECT forum_id, COUNT(*) as cnt FROM posts": standalonePostRows,
					"SELECT thread_id, COUNT(*) as cnt FROM posts": standaloneThreadRows,
				},
			});

			const res = await ban(
				createAdminRequest("POST", "/api/admin/users/42/ban", { deleteContent: true }),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.banned).toBe(true);
			expect(body.data.contentDeleted).toBe(true);
			expect(body.data.threadsDeleted).toBe(2);
			// 2 threads: (3+1)+(1+1)=6 posts from threads + 2 standalone = 8
			expect(body.data.postsDeleted).toBe(8);

			// Verify batch was called
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(9);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": null },
			});

			const res = await ban(
				createAdminRequest("POST", "/api/admin/users/999/ban", {}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should handle ban with no body (default no content deletion)", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
			});

			const res = await ban(
				new Request("https://api.example.com/api/admin/users/42/ban", {
					method: "POST",
					headers: { "X-API-Key": "test-api-key" },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.banned).toBe(true);
			expect(body.data.contentDeleted).toBe(false);
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("POST", "/api/admin/users/abc/ban");

			const res = await ban(request, adminEnv(db));

			expect(res.status).toBe(400);
		});
	});

	// ─── nuke ─────────────────────────────────────────────────

	describe("nuke", () => {
		it("should nuke user (ban + delete all + zero credits)", async () => {
			const threadRows = [{ id: 10, forum_id: 1, replies: 2 }];
			const standalonePostRows = [{ forum_id: 1, cnt: 3 }];
			const standaloneThreadRows = [{ thread_id: 20, cnt: 3 }];

			const { db, batchCalls } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": threadRows,
					"SELECT forum_id, COUNT(*) as cnt FROM posts": standalonePostRows,
					"SELECT thread_id, COUNT(*) as cnt FROM posts": standaloneThreadRows,
				},
			});

			const res = await nuke(createAdminRequest("POST", "/api/admin/users/42/nuke"), adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.nuked).toBe(true);
			expect(body.data.threadsDeleted).toBe(1);
			// 1 thread: (2+1)=3 posts from thread + 3 standalone = 6
			expect(body.data.postsDeleted).toBe(6);

			// Verify batch was called
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(6);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": null },
			});

			const res = await nuke(createAdminRequest("POST", "/api/admin/users/999/nuke"), adminEnv(db));

			expect(res.status).toBe(404);
		});

		it("should handle user with no content to delete", async () => {
			const { db, batchCalls } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": [],
					"SELECT forum_id, COUNT(*) as cnt FROM posts": [],
					"SELECT thread_id, COUNT(*) as cnt FROM posts": [],
				},
			});

			const res = await nuke(createAdminRequest("POST", "/api/admin/users/42/nuke"), adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.nuked).toBe(true);
			expect(body.data.threadsDeleted).toBe(0);
			expect(body.data.postsDeleted).toBe(0);

			// Batch: 1 delete standalone posts = 1 statement
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(1);
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("POST", "/api/admin/users/abc/nuke");

			const res = await nuke(request, adminEnv(db));

			expect(res.status).toBe(400);
		});
	});

	// ─── batchFetch ──────────────────────────────────────────

	describe("batchFetch", () => {
		it("should return users matching provided IDs", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE id IN": [makeD1UserRow({ id: 10 }), makeD1UserRow({ id: 20 })],
				},
			});

			const res = await batchFetch(
				createAdminRequest("GET", "/api/admin/users/batch?ids=10,20"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(2);
		});

		it("should return empty array for no matching IDs", async () => {
			const { db } = createMockDb({
				allResults: { "FROM users WHERE id IN": [] },
			});

			const res = await batchFetch(
				createAdminRequest("GET", "/api/admin/users/batch?ids=999"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toEqual([]);
		});

		it("should return 400 when ids param is missing", async () => {
			const { db } = createMockDb();

			const res = await batchFetch(
				createAdminRequest("GET", "/api/admin/users/batch"),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids query param required");
		});

		it("should return empty array for non-numeric IDs", async () => {
			const { db } = createMockDb();

			const res = await batchFetch(
				createAdminRequest("GET", "/api/admin/users/batch?ids=abc,def"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toEqual([]);
		});

		it("should reject batch exceeding 100 IDs", async () => {
			const { db } = createMockDb();
			const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");

			const res = await batchFetch(
				createAdminRequest("GET", `/api/admin/users/batch?ids=${ids}`),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should pass correct SQL with IN clause", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users WHERE id IN": [makeD1UserRow({ id: 5 })] },
			});

			await batchFetch(
				createAdminRequest("GET", "/api/admin/users/batch?ids=5,10,15"),
				adminEnv(db),
			);

			const inCall = calls.find((c) => c.sql.includes("IN"));
			expect(inCall?.sql).toContain("SELECT");
			expect(inCall?.params).toEqual([5, 10, 15]);
		});
	});

	// ─── batchStatus ──────────────────────────────────────────

	describe("batchStatus", () => {
		it("should batch update status for multiple users", async () => {
			const { db, calls } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-status", {
				ids: [10, 20, 30],
				status: -1,
			});
			const res = await batchStatus(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(3);

			// Verify SQL uses IN clause
			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET status"));
			expect(updateCall?.sql).toContain("IN");
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-status", {
				ids: [],
				status: -1,
			});
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should reject missing ids", async () => {
			const { db } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-status", { status: -1 });
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
		});

		it("should reject invalid status", async () => {
			const { db } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-status", {
				ids: [10],
				status: 5,
			});
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("status must be 0, -1, or -2");
		});

		it("should reject batch exceeding limit", async () => {
			const { db } = createMockDb();
			const ids = Array.from({ length: 101 }, (_, i) => i + 1);

			const request = createAdminRequest("POST", "/api/admin/users/batch-status", {
				ids,
				status: -1,
			});
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});
	});

	// ─── batchRole ────────────────────────────────────────────

	describe("batchRole", () => {
		it("should batch update role for multiple users", async () => {
			const { db, calls } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-role", {
				ids: [10, 20],
				role: 2,
			});
			const res = await batchRole(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(2);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET role"));
			expect(updateCall?.sql).toContain("IN");
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-role", {
				ids: [],
				role: 2,
			});
			const res = await batchRole(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should reject invalid role", async () => {
			const { db } = createMockDb();

			const request = createAdminRequest("POST", "/api/admin/users/batch-role", {
				ids: [10],
				role: 5,
			});
			const res = await batchRole(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("role must be 0, 1, 2, or 3");
		});

		it("should reject batch exceeding limit", async () => {
			const { db } = createMockDb();
			const ids = Array.from({ length: 101 }, (_, i) => i + 1);

			const request = createAdminRequest("POST", "/api/admin/users/batch-role", { ids, role: 2 });
			const res = await batchRole(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should return 400 for invalid JSON body", async () => {
			const { db } = createMockDb();
			const req = new Request("https://api.example.com/api/admin/users/batch-role", {
				method: "POST",
				headers: { "X-API-Key": "test-admin-api-key", "Content-Type": "application/json" },
				body: "not json",
			});
			const res = await batchRole(req, adminEnv(db));
			expect(res.status).toBe(400);
		});

		it("should return count 0 for NaN-only ids", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("POST", "/api/admin/users/batch-role", {
				ids: ["abc", "def"],
				role: 2,
			});
			const res = await batchRole(request, adminEnv(db));
			const body = await res.json();
			expect(res.status).toBe(200);
			expect(body.data.count).toBe(0);
		});
	});

	// ─── batchStatus — edge cases ────────────────────────────────

	describe("batchStatus — edge cases", () => {
		it("should return 400 for invalid JSON body", async () => {
			const { db } = createMockDb();
			const req = new Request("https://api.example.com/api/admin/users/batch-status", {
				method: "POST",
				headers: { "X-API-Key": "test-admin-api-key", "Content-Type": "application/json" },
				body: "not json",
			});
			const res = await batchStatus(req, adminEnv(db));
			expect(res.status).toBe(400);
		});

		it("should return count 0 for NaN-only ids", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("POST", "/api/admin/users/batch-status", {
				ids: ["abc", "def"],
				status: -1,
			});
			const res = await batchStatus(request, adminEnv(db));
			const body = await res.json();
			expect(res.status).toBe(200);
			expect(body.data.count).toBe(0);
		});
	});

	// ─── update — avatar validation ──────────────────────────────

	describe("update — avatar validation", () => {
		it("should update avatar with valid string", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, avatar: "new.png" }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				avatar: "new.png",
			});
			const res = await update(request, adminEnv(db));
			expect(res.status).toBe(200);
		});

		it("should reject non-string avatar", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = createAdminRequest("PATCH", "/api/admin/users/42", {
				avatar: 123,
			});
			const res = await update(request, adminEnv(db));
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("avatar must be a string");
		});
	});

	// ─── ban — collateral damage ─────────────────────────────────

	describe("ban — collateral damage", () => {
		it("should handle collateral author counts when deleting content", async () => {
			const threadRows = [{ id: 10, forum_id: 1, replies: 5 }];

			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": threadRows,
					"SELECT forum_id, COUNT(*) as cnt FROM posts": [],
					"SELECT thread_id, COUNT(*) as cnt FROM posts": [],
					"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN": [
						{ author_id: 99, cnt: 3 },
					],
				},
			});

			const res = await ban(
				createAdminRequest("POST", "/api/admin/users/42/ban", { deleteContent: true }),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.contentDeleted).toBe(true);
		});
	});

	// ─── recalcCounters ──────────────────────────────────────────

	describe("recalcCounters", () => {
		it("should recalculate counters for a user", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM users WHERE id": { id: 42 },
					"FROM posts WHERE author_id": { cnt: 20 },
					"digest > 0": { cnt: 2 },
					"FROM threads WHERE author_id": { cnt: 5 },
				},
			});

			const res = await recalcCounters(
				createAdminRequest("POST", "/api/admin/users/42/recalc-counters"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
			expect(body.data.threads).toBe(5);
			expect(body.data.posts).toBe(20);
			expect(body.data.digestPosts).toBe(2);
		});

		it("should return 400 for invalid user ID", async () => {
			const { db } = createMockDb();
			const res = await recalcCounters(
				createAdminRequest("POST", "/api/admin/users/abc/recalc-counters"),
				adminEnv(db),
			);
			expect(res.status).toBe(400);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": null },
			});
			const res = await recalcCounters(
				createAdminRequest("POST", "/api/admin/users/999/recalc-counters"),
				adminEnv(db),
			);
			expect(res.status).toBe(404);
		});

		it("should handle zero counts", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM users WHERE id": { id: 42 },
					// Null results → defaults to 0
				},
			});

			const res = await recalcCounters(
				createAdminRequest("POST", "/api/admin/users/42/recalc-counters"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.threads).toBe(0);
			expect(body.data.posts).toBe(0);
			expect(body.data.digestPosts).toBe(0);
		});
	});

	// ─── batchRecalcCounters ─────────────────────────────────────

	describe("batchRecalcCounters", () => {
		it("should recalculate counters for specific user IDs", async () => {
			const { db, batchCalls } = createMockDb({
				allResults: {
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN": [
						{ author_id: 1, cnt: 3 },
					],
					"SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN": [
						{ author_id: 1, cnt: 10 },
					],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (?,?) AND digest": [
						{ author_id: 1, cnt: 1 },
					],
				},
			});

			const res = await batchRecalcCounters(
				createAdminRequest("POST", "/api/admin/users/batch-recalc-counters", {
					ids: [1, 2],
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(2);
			expect(batchCalls.length).toBe(1);
		});

		it("should recalculate for all active users when no ids provided", async () => {
			const { db, batchCalls } = createMockDb({
				allResults: {
					"SELECT id FROM users WHERE status": [{ id: 1 }, { id: 2 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN": [],
					"SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN": [],
				},
			});

			const res = await batchRecalcCounters(
				createAdminRequest("POST", "/api/admin/users/batch-recalc-counters", {}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(2);
		});

		it("should return 400 for invalid JSON body", async () => {
			const { db } = createMockDb();
			const req = new Request("https://api.example.com/api/admin/users/batch-recalc-counters", {
				method: "POST",
				headers: { "X-API-Key": "test-admin-api-key", "Content-Type": "application/json" },
				body: "{ invalid json",
			});
			const res = await batchRecalcCounters(req, adminEnv(db));
			expect(res.status).toBe(400);
		});

		it("should return updated 0 for empty user list", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users WHERE status": [],
				},
			});

			const res = await batchRecalcCounters(
				createAdminRequest("POST", "/api/admin/users/batch-recalc-counters", {}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(0);
		});

		it("should reject batch exceeding 1000 IDs", async () => {
			const { db } = createMockDb();
			const ids = Array.from({ length: 1001 }, (_, i) => i + 1);

			const res = await batchRecalcCounters(
				createAdminRequest("POST", "/api/admin/users/batch-recalc-counters", { ids }),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should handle empty body text gracefully", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users WHERE status": [{ id: 1 }],
					"SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN": [],
					"SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN": [],
				},
			});

			const req = new Request("https://api.example.com/api/admin/users/batch-recalc-counters", {
				method: "POST",
				headers: { "X-API-Key": "test-admin-api-key" },
			});
			const res = await batchRecalcCounters(req, adminEnv(db));
			expect(res.status).toBe(200);
		});
	});

	// ─── listStaff ───────────────────────────────────────────────

	describe("listStaff", () => {
		it("should return staff users (role > 0)", async () => {
			const { db } = createMockDb({
				allResults: {
					"FROM users WHERE role > 0": [
						makeD1UserRow({ id: 1, role: 1, username: "admin" }),
						makeD1UserRow({ id: 2, role: 2, username: "supermod" }),
						makeD1UserRow({ id: 3, role: 3, username: "mod" }),
					],
				},
			});

			const res = await listStaff(
				createAdminRequest("GET", "/api/admin/users/staff"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(3);
		});

		it("should return empty array when no staff users exist", async () => {
			const { db } = createMockDb({
				allResults: { "FROM users WHERE role > 0": [] },
			});

			const res = await listStaff(
				createAdminRequest("GET", "/api/admin/users/staff"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toEqual([]);
		});
	});
});
