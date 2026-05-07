import { describe, expect, it } from "vitest";
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
	unban,
	update,
} from "../../../../src/handlers/admin/user";
import {
	createAdminRequest,
	createMockDb,
	createMockR2,
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

		it("should filter by regIp (exact)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const res = await list(
				createAdminRequest("GET", "/api/admin/users?regIp=1.2.3.4"),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const ipCall = calls.find((c) => c.sql.includes("reg_ip ="));
			expect(ipCall?.params).toContain("1.2.3.4");
			// Must be exact, not a LIKE search.
			expect(calls.some((c) => c.sql.includes("reg_ip LIKE"))).toBe(false);
		});

		it("should filter by lastIp (exact)", async () => {
			const { db, calls } = createMockDb({
				allResults: { "FROM users": [] },
				firstResults: { "SELECT COUNT": { total: 0 } },
			});

			const res = await list(
				createAdminRequest("GET", "/api/admin/users?lastIp=5.6.7.8"),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const ipCall = calls.find((c) => c.sql.includes("last_ip ="));
			expect(ipCall?.params).toContain("5.6.7.8");
			expect(calls.some((c) => c.sql.includes("last_ip LIKE"))).toBe(false);
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
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
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
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
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
			// 9 base statements + 2 child purges keyed on user's thread_ids
			// (DELETE attachments + DELETE post_comments) - 1 standalone
			// posts DELETE skipped because no `SELECT id FROM posts` mock
			// returns []. So: 9 - 1 + 2 = 10.
			expect(batchCalls[0].length).toBe(10);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id, status, role FROM users WHERE id": null },
			});

			const res = await ban(
				createAdminRequest("POST", "/api/admin/users/999/ban", {}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should handle ban with no body (default no content deletion)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
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

		it("purges attachments + post_comments by thread_id and post_id BEFORE DELETE FROM posts/threads (FK regression)", async () => {
			const threadRows = [{ id: 10, forum_id: 1, replies: 1 }];
			const standalonePostRows = [{ forum_id: 1, cnt: 1 }];
			const standaloneThreadRows = [{ thread_id: 20, cnt: 1 }];
			const standalonePostIdRows = [{ id: 77 }];

			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": threadRows,
					"SELECT forum_id, COUNT(*) as cnt FROM posts": standalonePostRows,
					"SELECT thread_id, COUNT(*) as cnt FROM posts": standaloneThreadRows,
					"SELECT id FROM posts WHERE author_id": standalonePostIdRows,
				},
			});

			const res = await ban(
				createAdminRequest("POST", "/api/admin/users/42/ban", { deleteContent: true }),
				adminEnv(db),
			);
			expect(res.status).toBe(200);

			const idxAttThread = calls.findIndex((c) =>
				c.sql.includes("DELETE FROM attachments WHERE thread_id IN"),
			);
			const idxCommentsThread = calls.findIndex((c) =>
				c.sql.includes("DELETE FROM post_comments WHERE thread_id IN"),
			);
			const idxAttPost = calls.findIndex((c) =>
				c.sql.includes("DELETE FROM attachments WHERE post_id IN"),
			);
			const idxCommentsPost = calls.findIndex((c) =>
				c.sql.includes("DELETE FROM post_comments WHERE post_id IN"),
			);
			const idxPosts = calls.findIndex((c) =>
				c.sql.startsWith("DELETE FROM posts WHERE thread_id"),
			);
			const idxStandalonePosts = calls.findIndex((c) =>
				c.sql.startsWith("DELETE FROM posts WHERE id IN"),
			);
			const idxThreads = calls.findIndex((c) => c.sql.startsWith("DELETE FROM threads WHERE id"));

			expect(idxAttThread).toBeGreaterThanOrEqual(0);
			expect(idxCommentsThread).toBeGreaterThanOrEqual(0);
			expect(idxAttPost).toBeGreaterThanOrEqual(0);
			expect(idxCommentsPost).toBeGreaterThanOrEqual(0);
			expect(idxPosts).toBeGreaterThan(idxAttThread);
			expect(idxPosts).toBeGreaterThan(idxCommentsThread);
			expect(idxThreads).toBeGreaterThan(idxPosts);
			expect(idxStandalonePosts).toBeGreaterThan(idxAttPost);
			expect(idxStandalonePosts).toBeGreaterThan(idxCommentsPost);

			// Hardening: standalone parent DELETE must NOT use the
			// batch-internal sub-query form, which would re-evaluate against
			// `threads` after the same batch has already deleted them.
			const drifty = calls.find(
				(c) =>
					c.sql.includes("DELETE FROM posts") &&
					c.sql.includes("author_id") &&
					c.sql.includes("thread_id NOT IN"),
			);
			expect(drifty).toBeUndefined();
		});
	});

	// ─── nuke ─────────────────────────────────────────────────

	describe("nuke", () => {
		it("should nuke user (ban + delete all + zero credits)", async () => {
			const threadRows = [{ id: 10, forum_id: 1, replies: 2 }];
			const standalonePostRows = [{ forum_id: 1, cnt: 3 }];
			const standaloneThreadRows = [{ thread_id: 20, cnt: 3 }];

			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
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
			// 6 base statements + 2 child purges keyed on user's thread_ids
			// (DELETE attachments + DELETE post_comments) - 1 standalone
			// posts DELETE skipped because no `SELECT id FROM posts` mock
			// returns []. So: 6 - 1 + 2 = 7.
			expect(batchCalls[0].length).toBe(7);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id, status, role FROM users WHERE id": null },
			});

			const res = await nuke(createAdminRequest("POST", "/api/admin/users/999/nuke"), adminEnv(db));

			expect(res.status).toBe(404);
		});

		it("should handle user with no content to delete", async () => {
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
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

			// No threads, no standalone posts → empty `statements` → batch
			// is skipped entirely (no_op no-op DELETE).
			expect(batchCalls.length).toBe(0);
		});

		it("should reject invalid user ID", async () => {
			const { db } = createMockDb();
			const request = createAdminRequest("POST", "/api/admin/users/abc/nuke");

			const res = await nuke(request, adminEnv(db));

			expect(res.status).toBe(400);
		});
	});

	// ─── D4-b: purge full pipeline + cross-handler ALREADY_PURGED guards ─────

	describe("purge (D4-b full pipeline)", () => {
		const targetRow = {
			id: 42,
			username: "victim",
			status: 0,
			role: 0,
			avatar_path: "avatars/42.png",
		};
		const validBody = { confirm: "ok" };

		// Build a request that carries audit headers like the admin proxy does.
		function purgeRequest(id: number, body: unknown, actor?: { email?: string; name?: string }) {
			const headers: Record<string, string> = {
				"X-API-Key": "test-admin-key",
				"Content-Type": "application/json",
			};
			if (actor?.email !== undefined) headers["X-Admin-Actor-Email"] = actor.email;
			if (actor?.name !== undefined) headers["X-Admin-Actor-Name"] = actor.name;
			return new Request(`https://api.example.com/api/admin/users/${id}/purge`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
		}

		it("returns 400 INVALID_BODY when body is not JSON", async () => {
			const { db } = createMockDb();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const req = new Request("https://api.example.com/api/admin/users/42/purge", {
				method: "POST",
				headers: { "X-API-Key": "test-admin-key", "Content-Type": "application/json" },
				body: "not-json",
			});
			const res = await purge(req, makeEnv({ DB: db, R2: createMockR2() }));
			expect(res.status).toBe(400);
			expect((await res.json()).error.code).toBe("INVALID_BODY");
		});

		it("returns 400 INVALID_BODY when confirm is missing", async () => {
			const { db } = createMockDb();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, {}), makeEnv({ DB: db, R2: createMockR2() }));
			expect(res.status).toBe(400);
			expect((await res.json()).error.code).toBe("INVALID_BODY");
		});

		it("returns 400 INVALID_BODY when confirm is not a string", async () => {
			const { db } = createMockDb();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(
				purgeRequest(42, { confirm: 123 }),
				makeEnv({ DB: db, R2: createMockR2() }),
			);
			expect(res.status).toBe(400);
			expect((await res.json()).error.code).toBe("INVALID_BODY");
		});

		it("returns 404 USER_NOT_FOUND when target row missing", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id, username, status, role, avatar_path FROM users": null },
			});
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, validBody), makeEnv({ DB: db, R2: createMockR2() }));
			expect(res.status).toBe(404);
			expect((await res.json()).error.code).toBe("USER_NOT_FOUND");
		});

		it('returns 400 CONFIRM_MISMATCH when confirm !== "ok"', async () => {
			const { db } = createMockDb();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(
				purgeRequest(42, { confirm: "yes" }),
				makeEnv({ DB: db, R2: createMockR2() }),
			);
			expect(res.status).toBe(400);
			expect((await res.json()).error.code).toBe("CONFIRM_MISMATCH");
		});

		it("returns 403 CANNOT_PURGE_STAFF when target.role > 0", async () => {
			for (const role of [1, 2, 3]) {
				const { db } = createMockDb({
					firstResults: {
						"SELECT id, username, status, role, avatar_path FROM users": {
							...targetRow,
							role,
						},
					},
				});
				const { purge } = await import("../../../../src/handlers/admin/user");

				const res = await purge(
					purgeRequest(42, validBody),
					makeEnv({ DB: db, R2: createMockR2() }),
				);
				expect(res.status, `role=${role}`).toBe(403);
				expect((await res.json()).error.code).toBe("CANNOT_PURGE_STAFF");
			}
		});

		it("returns 409 ALREADY_PURGED when target.status === -99", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, username, status, role, avatar_path FROM users": {
						...targetRow,
						status: -99,
					},
				},
			});
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, validBody), makeEnv({ DB: db, R2: createMockR2() }));
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
		});

		it("returns 400 for invalid path id", async () => {
			const { db } = createMockDb();
			const { purge } = await import("../../../../src/handlers/admin/user");
			const res = await purge(
				new Request("https://api.example.com/api/admin/users/abc/purge", {
					method: "POST",
					headers: { "X-API-Key": "test-admin-key", "Content-Type": "application/json" },
					body: JSON.stringify(validBody),
				}),
				makeEnv({ DB: db, R2: createMockR2() }),
			);
			expect(res.status).toBe(400);
		});

		it("happy path: runs DB batch in correct order, recalcs metadata, deletes R2, returns audit + counts", async () => {
			// Owned thread 100 in forum 7; one own post + one collateral post by user 99.
			// Target also has standalone post 201 in someone else's thread 300 (forum 8).
			const { db, calls, batchCalls } = createMockDb({
				firstResults: {
					"SELECT id, username, status, role, avatar_path FROM users": targetRow,
					"SELECT COUNT(DISTINCT id) as cnt FROM post_comments": { cnt: 5 },
					"SELECT COUNT(DISTINCT id) as cnt FROM attachments": { cnt: 4 },
					"SELECT COUNT(*) as cnt FROM messages": { cnt: 3 },
					"SELECT created_at, author_name, author_id\n\t\t\t FROM posts\n\t\t\t WHERE thread_id":
						null,
					"SELECT created_at, author_name, author_id FROM threads WHERE id": null,
					"SELECT id, subject, last_post_at, last_poster, last_poster_id\n\t\t\t FROM threads\n\t\t\t WHERE forum_id":
						null,
				},
				allResults: {
					"SELECT id, forum_id FROM threads WHERE author_id": [{ id: 100, forum_id: 7 }],
					"SELECT id, author_id FROM posts WHERE thread_id IN": [
						{ id: 150, author_id: 42 },
						{ id: 151, author_id: 99 },
					],
					"SELECT id, thread_id, forum_id FROM posts WHERE author_id = ? AND thread_id NOT IN": [
						{ id: 201, thread_id: 300, forum_id: 8 },
					],
					"SELECT DISTINCT file_path FROM attachments": [
						{ file_path: "att/a.png" },
						{ file_path: "att/b.png" },
					],
				},
			});

			const r2 = createMockR2();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(
				purgeRequest(42, validBody, { email: "admin@example.com", name: "Admin User" }),
				makeEnv({ DB: db, R2: r2 }),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.purged).toBe(true);
			expect(body.data.id).toBe(42);
			expect(body.data.deleted).toEqual({
				threads: 1,
				posts: 3, // 2 owned-thread posts + 1 standalone
				comments: 5,
				attachments: 4, // distinct attachment row count (NOT distinct file_path count)
				messages: 3,
			});
			expect(body.data.audit).toEqual({
				actorEmail: "admin@example.com",
				actorName: "Admin User",
			});
			expect(body.data.r2.deletedCount).toBe(3); // 2 attachments + 1 avatar
			expect(body.data.r2.failed).toEqual([]);

			// Exactly one DB batch.
			expect(batchCalls).toHaveLength(1);
			// audit-table negative assertion (across all SQL prepared in this test):
			const allSqls = calls.map((c) => c.sql).join("\n");
			expect(allSqls).not.toMatch(/\bFROM reports\b/);
			expect(allSqls).not.toMatch(/\bFROM admin_logs\b/);
			expect(allSqls).not.toMatch(/\bFROM ip_bans\b/);
			expect(allSqls).not.toMatch(/\bFROM censor_words\b/);
			expect(allSqls).not.toMatch(/\bFROM announcements\b/);
			expect(allSqls).not.toMatch(/DELETE FROM reports/);
			expect(allSqls).not.toMatch(/DELETE FROM admin_logs/);
			expect(allSqls).not.toMatch(/DELETE FROM ip_bans/);

			// Schema column-name sanity:
			expect(allSqls).toMatch(/threads WHERE author_id/);
			expect(allSqls).toMatch(/posts WHERE author_id/);
			expect(allSqls).toMatch(/messages WHERE sender_id = \? OR receiver_id = \?/);
			expect(allSqls).toMatch(/attachments/);
			expect(allSqls).toMatch(/file_path/);

			// Visibility constants used in counter repair:
			expect(allSqls).toMatch(/sticky >= 0/);
			expect(allSqls).toMatch(/invisible = 0/);

			// post_comments + attachments DELETE both use the 3-way OR clause
			// so that target's own contributions in survivor threads are wiped.
			const commentDeleteSql = calls
				.map((c) => c.sql)
				.find((s) => /^DELETE FROM post_comments\b/.test(s));
			const attachmentDeleteSql = calls
				.map((c) => c.sql)
				.find((s) => /^DELETE FROM attachments\b/.test(s));
			expect(commentDeleteSql).toMatch(/author_id = \?/);
			expect(commentDeleteSql).toMatch(/post_id IN/);
			expect(commentDeleteSql).toMatch(/thread_id IN/);
			expect(attachmentDeleteSql).toMatch(/author_id = \?/);
			expect(attachmentDeleteSql).toMatch(/post_id IN/);
			expect(attachmentDeleteSql).toMatch(/thread_id IN/);

			// R2 was hit for both attachment keys + avatar.
			expect(
				(r2.delete as ReturnType<typeof import("vitest").vi.fn>).mock.calls
					.map((c: unknown[]) => c[0])
					.sort(),
			).toEqual(["att/a.png", "att/b.png", "avatars/42.png"]);
		});

		it("returns 500 PURGE_DB_FAILED if DB batch throws (R2 not touched)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, username, status, role, avatar_path FROM users": targetRow,
					"SELECT COUNT(DISTINCT id) as cnt FROM post_comments": { cnt: 0 },
					"SELECT COUNT(*) as cnt FROM messages": { cnt: 0 },
				},
				allResults: {
					"SELECT id, forum_id FROM threads WHERE author_id": [],
					"SELECT id, thread_id, forum_id FROM posts WHERE author_id": [],
					"SELECT DISTINCT file_path FROM attachments": [],
				},
			});
			(db.batch as ReturnType<typeof import("vitest").vi.fn>).mockRejectedValueOnce(
				new Error("d1 batch boom"),
			);
			const r2 = createMockR2();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, validBody), makeEnv({ DB: db, R2: r2 }));
			expect(res.status).toBe(500);
			expect((await res.json()).error.code).toBe("PURGE_DB_FAILED");
			expect((r2.delete as ReturnType<typeof import("vitest").vi.fn>).mock.calls).toHaveLength(0);
		});

		it("R2 failures are recorded in response.r2.failed without failing the request", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, username, status, role, avatar_path FROM users": targetRow,
					"SELECT COUNT(DISTINCT id) as cnt FROM post_comments": { cnt: 0 },
					"SELECT COUNT(*) as cnt FROM messages": { cnt: 0 },
				},
				allResults: {
					"SELECT id, forum_id FROM threads WHERE author_id": [],
					"SELECT id, thread_id, forum_id FROM posts WHERE author_id": [],
					"SELECT DISTINCT file_path FROM attachments": [],
				},
			});
			const r2 = createMockR2();
			(r2.delete as ReturnType<typeof import("vitest").vi.fn>).mockImplementationOnce(async () => {
				throw new Error("r2 boom");
			});
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, validBody), makeEnv({ DB: db, R2: r2 }));
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.r2.deletedCount).toBe(0);
			expect(body.data.r2.failed).toEqual([{ key: "avatars/42.png", error: "r2 boom" }]);
		});

		it("survivor-thread-only: deletes target's own post_comments via author_id even when no posts/threads belong to target", async () => {
			// User 42 owns nothing (no threads, no posts), but has written
			// post_comments inside someone else's thread. Pure author_id branch.
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, username, status, role, avatar_path FROM users": targetRow,
					"SELECT COUNT(DISTINCT id) as cnt FROM post_comments": { cnt: 7 },
					"SELECT COUNT(DISTINCT id) as cnt FROM attachments": { cnt: 0 },
					"SELECT COUNT(*) as cnt FROM messages": { cnt: 0 },
				},
				allResults: {
					"SELECT id, forum_id FROM threads WHERE author_id": [],
					"SELECT id, thread_id, forum_id FROM posts WHERE author_id": [],
					"SELECT DISTINCT file_path FROM attachments": [],
				},
			});
			const r2 = createMockR2();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, validBody), makeEnv({ DB: db, R2: r2 }));
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.deleted.comments).toBe(7);
			expect(body.data.deleted.attachments).toBe(0);

			const commentDeleteSql = calls
				.map((c) => c.sql)
				.find((s) => /^DELETE FROM post_comments\b/.test(s));
			expect(commentDeleteSql).toMatch(/author_id = \?/);
			// No posts/threads → only author_id branch in the WHERE.
			expect(commentDeleteSql).not.toMatch(/post_id IN/);
			expect(commentDeleteSql).not.toMatch(/thread_id IN/);
		});

		it("returns 500 PURGE_RECALC_FAILED if recalcMetadata throws AFTER batch (R2 not touched)", async () => {
			// Owned thread present so survivor-thread / forum recalc actually runs.
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, username, status, role, avatar_path FROM users": targetRow,
					"SELECT COUNT(DISTINCT id) as cnt FROM post_comments": { cnt: 0 },
					"SELECT COUNT(DISTINCT id) as cnt FROM attachments": { cnt: 0 },
					"SELECT COUNT(*) as cnt FROM messages": { cnt: 0 },
					"SELECT created_at, author_name, author_id\n\t\t\t FROM posts\n\t\t\t WHERE thread_id":
						null,
					"SELECT created_at, author_name, author_id FROM threads WHERE id": null,
				},
				allResults: {
					"SELECT id, forum_id FROM threads WHERE author_id": [{ id: 100, forum_id: 7 }],
					"SELECT id, thread_id, forum_id FROM posts WHERE author_id = ? AND thread_id NOT IN": [
						{ id: 201, thread_id: 300, forum_id: 8 },
					],
					"SELECT DISTINCT file_path FROM attachments": [],
				},
			});
			// Wrap prepare: when recalcThreadMetadata's first SELECT runs, throw.
			// (recalcThreadMetadata's first query starts with
			// `SELECT created_at, author_name, author_id\n\t\t\t FROM posts\n\t\t\t WHERE thread_id`.)
			const origPrepareImpl = (
				db.prepare as ReturnType<typeof import("vitest").vi.fn>
			).getMockImplementation();
			(db.prepare as ReturnType<typeof import("vitest").vi.fn>).mockImplementation(
				(sql: string) => {
					if (
						/SELECT created_at, author_name, author_id\s+FROM posts\s+WHERE thread_id/.test(sql)
					) {
						return {
							bind: vi.fn(() => ({
								first: vi.fn(async () => {
									throw new Error("recalc boom");
								}),
								all: vi.fn(async () => ({ results: [] })),
								run: vi.fn(async () => ({ success: true, meta: {} })),
							})),
						};
					}
					return origPrepareImpl?.(sql);
				},
			);
			const r2 = createMockR2();
			const { purge } = await import("../../../../src/handlers/admin/user");

			const res = await purge(purgeRequest(42, validBody), makeEnv({ DB: db, R2: r2 }));
			expect(res.status).toBe(500);
			expect((await res.json()).error.code).toBe("PURGE_RECALC_FAILED");
			expect((r2.delete as ReturnType<typeof import("vitest").vi.fn>).mock.calls).toHaveLength(0);
		});
	});

	describe("ALREADY_PURGED cross-handler guards (D4-a)", () => {
		const purgedRow = makeD1UserRow({ id: 42, status: -99 });

		it("update rejects with 409 ALREADY_PURGED on tombstoned user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM users WHERE id": purgedRow },
			});
			const res = await update(
				createAdminRequest("PATCH", "/api/admin/users/42", { credits: 1 }),
				adminEnv(db),
			);
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
		});

		it("ban rejects with 409 ALREADY_PURGED on tombstoned user", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: -99, role: 0 },
				},
			});
			const res = await ban(createAdminRequest("POST", "/api/admin/users/42/ban"), adminEnv(db));
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
		});

		it("nuke rejects with 409 ALREADY_PURGED on tombstoned user", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: -99, role: 0 },
				},
			});
			const res = await nuke(createAdminRequest("POST", "/api/admin/users/42/nuke"), adminEnv(db));
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
		});

		// D4-b additions: batch endpoints + recalcCounters.

		it("batchStatus rejects with 409 when any id is tombstoned", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users WHERE id IN": [{ id: 42 }],
				},
			});
			const res = await batchStatus(
				createAdminRequest("POST", "/api/admin/users/batch-status", {
					ids: [42, 43],
					status: 0,
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe("ALREADY_PURGED");
			expect(body.error.details.tombstoneIds).toEqual([42]);
		});

		it("batchRole rejects with 409 when any id is tombstoned", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users WHERE id IN": [{ id: 42 }],
				},
			});
			const res = await batchRole(
				createAdminRequest("POST", "/api/admin/users/batch-role", {
					ids: [42, 43],
					role: 0,
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
		});

		it("recalcCounters rejects with 409 on tombstoned user", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status FROM users WHERE id": { id: 42, status: -99 },
				},
			});
			const res = await recalcCounters(
				createAdminRequest("POST", "/api/admin/users/42/recalc-counters"),
				adminEnv(db),
			);
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
		});

		it("batchRecalcCounters rejects with 409 on explicit tombstoned id", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id FROM users WHERE id IN": [{ id: 42 }],
				},
			});
			const res = await batchRecalcCounters(
				createAdminRequest("POST", "/api/admin/users/batch-recalc-counters", {
					ids: [42, 43],
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(409);
			expect((await res.json()).error.code).toBe("ALREADY_PURGED");
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
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
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
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status FROM users WHERE id": { id: 42, status: 0 },
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
					"SELECT id, status FROM users WHERE id": { id: 42, status: 0 },
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
			const { db } = createMockDb({
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

	// ─── F3-a: unban + audit-log instrumentation ─────────────

	function actorHeaders(): Record<string, string> {
		return {
			"X-Admin-Actor-Email": "alice@example.com",
			"X-Admin-Actor-Name": "Alice",
			"CF-Connecting-IP": "1.2.3.4",
		};
	}

	function adminMutationReq(
		method: string,
		path: string,
		body?: unknown,
		extraHeaders?: Record<string, string>,
	): Request {
		const headers: Record<string, string> = {
			"X-API-Key": "test-api-key",
			"Content-Type": "application/json",
			...actorHeaders(),
			...(extraHeaders ?? {}),
		};
		return new Request(`https://api.example.com${path}`, {
			method,
			headers,
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
	}

	describe("unban", () => {
		it("flips status from -1 to 0 on a banned user", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: -1, role: 0 },
				},
			});

			const res = await unban(adminMutationReq("POST", "/api/admin/users/42/unban"), adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toEqual({ unbanned: true, id: 42, previousStatus: -1 });
			const update = calls.find(
				(c) => c.sql.includes("UPDATE users SET status = 0") && c.params[0] === 42,
			);
			expect(update).toBeTruthy();
		});

		it("rejects non-banned user with INVALID_REQUEST", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
			});
			const res = await unban(adminMutationReq("POST", "/api/admin/users/42/unban"), adminEnv(db));
			const body = await res.json();
			expect(res.status).toBe(400);
			expect(body.error.code).toBe("INVALID_REQUEST");
		});

		it("rejects already-purged tombstone with ALREADY_PURGED", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: -99, role: 0 },
				},
			});
			const res = await unban(adminMutationReq("POST", "/api/admin/users/42/unban"), adminEnv(db));
			expect(res.status).toBe(409);
		});

		it("returns 404 for missing user", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id, status, role FROM users WHERE id": null },
			});
			const res = await unban(adminMutationReq("POST", "/api/admin/users/999/unban"), adminEnv(db));
			expect(res.status).toBe(404);
		});

		it("rejects invalid user ID", async () => {
			const { db } = createMockDb();
			const res = await unban(adminMutationReq("POST", "/api/admin/users/abc/unban"), adminEnv(db));
			expect(res.status).toBe(400);
		});
	});

	describe("F3-a audit instrumentation", () => {
		function findAuditInsert(calls: { sql: string; params: unknown[] }[]) {
			return calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		}

		it("ban (no content delete) writes a user.ban audit row with actor", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
			});
			const res = await ban(adminMutationReq("POST", "/api/admin/users/42/ban", {}), adminEnv(db));
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			// binds: admin_id, admin_name, action, target_type, target_id, details, ip, created_at
			expect(insert?.params[1]).toBe("Alice");
			expect(insert?.params[2]).toBe("user.ban");
			expect(insert?.params[3]).toBe("user");
			expect(insert?.params[4]).toBe(42);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.mode).toBe("ban");
			expect(details.deletedContent).toBe(false);
			expect(details.actorEmail).toBe("alice@example.com");
			expect(insert?.params[6]).toBe("1.2.3.4");
		});

		it("ban (with content delete) records counts in details", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": [
						{ id: 10, forum_id: 1, replies: 3 },
					],
					"SELECT forum_id, COUNT(*) as cnt FROM posts": [{ forum_id: 1, cnt: 2 }],
					"SELECT thread_id, COUNT(*) as cnt FROM posts": [{ thread_id: 20, cnt: 2 }],
				},
			});
			const res = await ban(
				adminMutationReq("POST", "/api/admin/users/42/ban", { deleteContent: true }),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.mode).toBe("ban_delete_content");
			expect(details.deletedContent).toBe(true);
			expect(details.deletedThreads).toBe(1);
			expect(details.deletedPosts).toBeGreaterThan(0);
		});

		it("unban writes user.unban with previousStatus", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: -1, role: 0 },
				},
			});
			await unban(adminMutationReq("POST", "/api/admin/users/42/unban"), adminEnv(db));
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("user.unban");
			expect(insert?.params[4]).toBe(42);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.previousStatus).toBe(-1);
			expect(details.actorEmail).toBe("alice@example.com");
		});

		it("nuke writes user.nuke with deletion counts", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: 0, role: 0 },
				},
				allResults: {
					"SELECT id, forum_id, replies FROM threads WHERE author_id": [
						{ id: 10, forum_id: 1, replies: 2 },
					],
					"SELECT forum_id, COUNT(*) as cnt FROM posts": [{ forum_id: 1, cnt: 3 }],
					"SELECT thread_id, COUNT(*) as cnt FROM posts": [{ thread_id: 20, cnt: 3 }],
				},
			});
			const res = await nuke(adminMutationReq("POST", "/api/admin/users/42/nuke"), adminEnv(db));
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("user.nuke");
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.deletedThreads).toBe(1);
			expect(details.deletedPosts).toBeGreaterThan(0);
		});

		it("system actor (no headers) writes admin_name=system and no actorEmail in details", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id, status, role FROM users WHERE id": { id: 42, status: -1, role: 0 },
				},
			});
			const req = new Request("https://api.example.com/api/admin/users/42/unban", {
				method: "POST",
				headers: { "X-API-Key": "test-api-key" },
			});
			await unban(req, adminEnv(db));
			const insert = findAuditInsert(calls);
			expect(insert?.params[1]).toBe("system");
			const details = JSON.parse(insert?.params[5] as string);
			expect("actorEmail" in details).toBe(false);
		});
	});
});
