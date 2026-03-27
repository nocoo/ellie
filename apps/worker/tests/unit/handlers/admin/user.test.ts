import { describe, expect, it } from "bun:test";
import { ban, getById, list, nuke, setRole, setStatus } from "../../../../src/handlers/admin/user";
import {
	createAdminRequest,
	createJwtForRole,
	createMockDb,
	makeD1UserRow,
	makeEnv,
} from "../../../helpers";

describe("admin user handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

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

			// Verify SQL does not use SELECT *
			const selectCall = calls.find((c) => c.sql.includes("FROM users WHERE id"));
			expect(selectCall?.sql).not.toContain("SELECT *");
			expect(selectCall?.sql).not.toContain("password");
		});
	});

	describe("setStatus", () => {
		it("should update user status", async () => {
			const { db } = createMockDb({
				runResults: {
					"UPDATE users SET status": { success: true, meta: { changes: 1 } },
				},
			});

			const token = await createJwtForRole(1, 99); // userId=99
			const res = await setStatus(
				new Request("https://api.example.com/api/admin/users/42/status", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ status: -1 }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.status).toBe(-1);
		});

		it("should prevent self-ban", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1, 42); // userId=42
			const res = await setStatus(
				new Request("https://api.example.com/api/admin/users/42/status", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ status: -1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("SELF_BAN");
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				runResults: {
					"UPDATE users SET status": { success: true, meta: { changes: 0 } },
				},
			});

			const token = await createJwtForRole(1, 99);
			const res = await setStatus(
				new Request("https://api.example.com/api/admin/users/42/status", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ status: -1 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should reject missing status", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1, 99);
			const res = await setStatus(
				new Request("https://api.example.com/api/admin/users/42/status", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ foo: "bar" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("status is required (number)");
		});
	});

	describe("setRole", () => {
		it("should update user role", async () => {
			const { db } = createMockDb({
				runResults: {
					"UPDATE users SET role": { success: true, meta: { changes: 1 } },
				},
			});

			const token = await createJwtForRole(1, 99);
			const res = await setRole(
				new Request("https://api.example.com/api/admin/users/42/role", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ role: 3 }),
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.updated).toBe(true);
			expect(body.data.role).toBe(3);
		});

		it("should prevent self-role-change", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1, 42);
			const res = await setRole(
				new Request("https://api.example.com/api/admin/users/42/role", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ role: 0 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("SELF_ROLE_CHANGE");
		});

		it("should reject invalid role value", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1, 99);
			const res = await setRole(
				new Request("https://api.example.com/api/admin/users/42/role", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ role: 5 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("role must be 0-3");
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				runResults: {
					"UPDATE users SET role": { success: true, meta: { changes: 0 } },
				},
			});

			const token = await createJwtForRole(1, 99);
			const res = await setRole(
				new Request("https://api.example.com/api/admin/users/42/role", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ role: 0 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});
	});

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
			// Statements: 1 ban + 2 delete thread posts + 2 delete threads + 1 delete standalone posts
			//           + 1 update standalone thread replies + 2 update forum (threads) + 1 update forum (standalone)
			expect(batchCalls[0].length).toBe(10);
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
	});

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
			// Statements: 1 nuke user + 1 delete thread posts + 1 delete thread
			//           + 1 delete standalone posts + 1 update standalone thread replies
			//           + 1 update forum (threads) + 1 update forum (standalone) = 7
			expect(batchCalls[0].length).toBe(7);
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

			// Batch: 1 nuke user + 1 delete standalone posts = 2
			expect(batchCalls.length).toBe(1);
			expect(batchCalls[0].length).toBe(2);
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
	});

	describe("ID validation guards", () => {
		it("getById should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/users/abc");

			const response = await getById(request, env);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.details.message).toBe("Invalid user ID");
		});

		it("setStatus should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/users/abc/status", {
				status: 0,
			});

			const response = await setStatus(request, env);

			expect(response.status).toBe(400);
		});

		it("setRole should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/users/abc/role", { role: 0 });

			const response = await setRole(request, env);

			expect(response.status).toBe(400);
		});

		it("ban should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/users/abc/ban");

			const response = await ban(request, env);

			expect(response.status).toBe(400);
		});
	});
});
