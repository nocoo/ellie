import { describe, expect, it } from "bun:test";
import {
	ban,
	batchRole,
	batchStatus,
	getById,
	list,
	nuke,
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
	});
});
