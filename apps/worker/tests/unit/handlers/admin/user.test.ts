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
import {
	createAdminRequest,
	createJwtForRole,
	createMockDb,
	makeD1UserRow,
	makeEnv,
} from "../../../helpers";

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

			const token = await createJwtForRole(1); // Admin
			const res = await list(
				new Request("https://api.example.com/api/admin/users?page=1&limit=20", {
					headers: { Authorization: `Bearer ${token}` },
				}),
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

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/users?username=alice", {
					headers: { Authorization: `Bearer ${token}` },
				}),
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

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/users?email=test@example.com", {
					headers: { Authorization: `Bearer ${token}` },
				}),
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

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/users?status=-1", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const statusCall = calls.find((c) => c.sql.includes("status ="));
			expect(statusCall?.params).toContain(-1);
		});

		it("should filter by role", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/users?role=3", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const roleCall = calls.find((c) => c.sql.includes("role ="));
			expect(roleCall?.params).toContain(3);
		});

		it("should reject non-admin roles", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(3); // Mod
			const res = await list(
				new Request("https://api.example.com/api/admin/users", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(403);
		});

		it("should reject invalid page number", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/users?page=0", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

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

			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/users/42", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "FROM users WHERE id": null },
			});

			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/users/999", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should never expose password fields", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "FROM users WHERE id": makeD1UserRow({ id: 1 }) },
			});

			const token = await createJwtForRole(1);
			await getById(
				new Request("https://api.example.com/api/admin/users/1", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			// Verify SQL uses explicit columns, not SELECT *
			const selectCall = calls.find((c) => c.sql.includes("FROM users WHERE id"));
			expect(selectCall?.sql).not.toContain("SELECT *");
			expect(selectCall?.sql).not.toContain("password");
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = await createAdminRequest("GET", "/api/admin/users/abc");

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
				// fetchRowFull for existence check (SELECT *)
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					// username uniqueness check
					"SELECT id FROM users WHERE username": null,
					// fetchRow for response (explicit columns)
					"SELECT id, username": makeD1UserRow({ id: 42, username: "newname" }),
				},
			});

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					username: "newname",
				},
				1,
				99,
			);
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

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					email: "new@example.com",
				},
				1,
				99,
			);
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

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					credits: 500,
				},
				1,
				99,
			);
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should update status for another user", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, status: -1 }),
				},
			});

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					status: -1,
				},
				1,
				99,
			); // userId=99, targeting user 42
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should update role for another user", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					"SELECT id, username": makeD1UserRow({ id: 42, role: 2 }),
				},
			});

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					role: 2,
				},
				1,
				99,
			);
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(200);
		});

		it("should prevent self-ban (SELF_BAN) when updating own status", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					status: -1,
				},
				1,
				42,
			); // userId=42, targeting self
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("SELF_BAN");
		});

		it("should prevent self-role-change (SELF_ROLE_CHANGE) when updating own role", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					role: 0,
				},
				1,
				42,
			); // userId=42, targeting self
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("SELF_ROLE_CHANGE");
		});

		it("should reject USERNAME_TAKEN", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
					// username uniqueness check returns an existing user
					"SELECT id FROM users WHERE username": { id: 99 },
				},
			});

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					username: "taken",
				},
				1,
				99,
			);
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe("USERNAME_TAKEN");
		});

		it("should reject empty body (no fields)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM users WHERE id": makeD1UserRow({ id: 42 }),
				},
			});

			const request = await createAdminRequest("PATCH", "/api/admin/users/42", {}, 1, 99);
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

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					status: 5,
				},
				1,
				99,
			);
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

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					role: 5,
				},
				1,
				99,
			);
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

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/42",
				{
					email: "notanemail",
				},
				1,
				99,
			);
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

			const request = await createAdminRequest(
				"PATCH",
				"/api/admin/users/999",
				{
					username: "test",
				},
				1,
				99,
			);
			const res = await update(request, adminEnv(db));

			expect(res.status).toBe(404);
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = await createAdminRequest("PATCH", "/api/admin/users/abc", {
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

			const token = await createJwtForRole(1, 99);
			const res = await ban(
				new Request("https://api.example.com/api/admin/users/42/ban", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
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

			const token = await createJwtForRole(1, 99);
			const res = await ban(
				new Request("https://api.example.com/api/admin/users/42/ban", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ deleteContent: true }),
				}),
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
			// Statements: 2 delete thread posts + 2 delete threads + 1 delete standalone posts
			//           + 1 update standalone thread replies + 2 update forum (threads) + 1 update forum (standalone)
			expect(batchCalls[0].length).toBe(9);
		});

		it("should prevent self-ban", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1, 42);
			const res = await ban(
				new Request("https://api.example.com/api/admin/users/42/ban", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("SELF_BAN");
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": null },
			});

			const token = await createJwtForRole(1, 99);
			const res = await ban(
				new Request("https://api.example.com/api/admin/users/999/ban", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should handle ban with no body (default no content deletion)", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": { id: 42 } },
			});

			const token = await createJwtForRole(1, 99);
			const res = await ban(
				new Request("https://api.example.com/api/admin/users/42/ban", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
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
			const request = await createAdminRequest("POST", "/api/admin/users/abc/ban");

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

			const token = await createJwtForRole(1, 99);
			const res = await nuke(
				new Request("https://api.example.com/api/admin/users/42/nuke", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.nuked).toBe(true);
			expect(body.data.threadsDeleted).toBe(1);
			// 1 thread: (2+1)=3 posts from thread + 3 standalone = 6
			expect(body.data.postsDeleted).toBe(6);

			// Verify batch was called
			expect(batchCalls.length).toBe(1);
			// Statements: 1 delete thread posts + 1 delete thread
			//           + 1 delete standalone posts + 1 update standalone thread replies
			//           + 1 update forum (threads) + 1 update forum (standalone) = 6
			expect(batchCalls[0].length).toBe(6);
		});

		it("should prevent self-nuke", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1, 42);
			const res = await nuke(
				new Request("https://api.example.com/api/admin/users/42/nuke", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("SELF_BAN");
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM users WHERE id": null },
			});

			const token = await createJwtForRole(1, 99);
			const res = await nuke(
				new Request("https://api.example.com/api/admin/users/999/nuke", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

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

			const token = await createJwtForRole(1, 99);
			const res = await nuke(
				new Request("https://api.example.com/api/admin/users/42/nuke", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.nuked).toBe(true);
			expect(body.data.threadsDeleted).toBe(0);
			expect(body.data.postsDeleted).toBe(0);

			// Batch: 1 delete standalone posts = 1 statement
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(1);
		});

		it("should reject non-admin roles (mod)", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(3); // Mod
			const res = await nuke(
				new Request("https://api.example.com/api/admin/users/42/nuke", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(403);
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = await createAdminRequest("POST", "/api/admin/users/abc/nuke");

			const res = await nuke(request, adminEnv(db));

			expect(res.status).toBe(400);
		});
	});

	// ─── batchStatus ──────────────────────────────────────────

	describe("batchStatus", () => {
		it("should batch update status for multiple users", async () => {
			const { db, calls } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ ids: [10, 20, 30], status: -1 },
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(3);

			// Verify SQL uses IN clause
			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET status"));
			expect(updateCall?.sql).toContain("IN");
		});

		it("should auto-exclude current user from batch", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ ids: [10, 99, 30], status: -1 }, // userId=99 is the admin
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.count).toBe(2); // 99 excluded
		});

		it("should return count=0 when all ids are self", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ ids: [99], status: -1 },
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(0);
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ ids: [], status: -1 },
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should reject missing ids", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ status: -1 },
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
		});

		it("should reject invalid status", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ ids: [10], status: 5 },
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("status must be 0, -1, or -2");
		});

		it("should reject batch exceeding limit", async () => {
			const { db } = createMockDb();
			const ids = Array.from({ length: 101 }, (_, i) => i + 1);

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-status",
				{ ids, status: -1 },
				1,
				99,
			);
			const res = await batchStatus(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should reject non-admin roles", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(3); // Mod
			const res = await batchStatus(
				new Request("https://api.example.com/api/admin/users/batch-status", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ ids: [1], status: -1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(403);
		});
	});

	// ─── batchRole ────────────────────────────────────────────

	describe("batchRole", () => {
		it("should batch update role for multiple users", async () => {
			const { db, calls } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-role",
				{ ids: [10, 20], role: 2 },
				1,
				99,
			);
			const res = await batchRole(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(2);

			const updateCall = calls.find((c) => c.sql.includes("UPDATE users SET role"));
			expect(updateCall?.sql).toContain("IN");
		});

		it("should auto-exclude current user from batch", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-role",
				{ ids: [10, 99], role: 0 },
				1,
				99,
			);
			const res = await batchRole(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.count).toBe(1); // 99 excluded
		});

		it("should return count=0 when all ids are self", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-role",
				{ ids: [99], role: 0 },
				1,
				99,
			);
			const res = await batchRole(request, adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(0);
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-role",
				{ ids: [], role: 2 },
				1,
				99,
			);
			const res = await batchRole(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("ids must be a non-empty array");
		});

		it("should reject invalid role", async () => {
			const { db } = createMockDb();

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-role",
				{ ids: [10], role: 5 },
				1,
				99,
			);
			const res = await batchRole(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("role must be 0, 1, 2, or 3");
		});

		it("should reject batch exceeding limit", async () => {
			const { db } = createMockDb();
			const ids = Array.from({ length: 101 }, (_, i) => i + 1);

			const request = await createAdminRequest(
				"POST",
				"/api/admin/users/batch-role",
				{ ids, role: 2 },
				1,
				99,
			);
			const res = await batchRole(request, adminEnv(db));

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should reject non-admin roles", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(3); // Mod
			const res = await batchRole(
				new Request("https://api.example.com/api/admin/users/batch-role", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ ids: [1], role: 0 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(403);
		});
	});
});
