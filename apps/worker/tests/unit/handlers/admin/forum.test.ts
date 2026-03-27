import { describe, expect, it } from "bun:test";
import { create, getById, list, remove, update } from "../../../../src/handlers/admin/forum";
import { createJwtForRole, createMockDb, makeD1ForumRow, makeEnv } from "../../../helpers";

describe("admin forum handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	describe("list", () => {
		it("should return all forums including hidden", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT * FROM forums ORDER": [
						makeD1ForumRow({ id: 1, status: 1, name: "Visible" }),
						makeD1ForumRow({ id: 2, status: 0, name: "Hidden" }),
					],
				},
			});

			const token = await createJwtForRole(1); // Admin
			const res = await list(
				new Request("https://api.example.com/api/admin/forums", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(2);
			expect(body.data[0].name).toBe("Visible");
			expect(body.data[1].name).toBe("Hidden");
		});

		it("should return empty array when no forums", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await list(
				new Request("https://api.example.com/api/admin/forums", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toEqual([]);
		});

		it("should require admin auth", async () => {
			const { db } = createMockDb();
			const res = await list(new Request("https://api.example.com/api/admin/forums"), adminEnv(db));
			// No API key = 401 from api key gate (actually wait, handlers don't check api key, router does)
			// But since we're calling handler directly, it needs JWT
			// The handler is wrapped with withAdmin, so it will call authMiddleware
			expect(res.status).toBe(401);
		});

		it("should reject regular user", async () => {
			const token = await createJwtForRole(0); // User
			const { db } = createMockDb();
			const res = await list(
				new Request("https://api.example.com/api/admin/forums", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(403);
		});
	});

	describe("getById", () => {
		it("should return forum by ID", async () => {
			const forumRow = makeD1ForumRow({ id: 42, name: "Test Forum" });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM forums WHERE id": forumRow },
			});

			const token = await createJwtForRole(1); // Admin
			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/42", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
			expect(body.data.name).toBe("Test Forum");
		});

		it("should return 404 for non-existent forum", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/999", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("FORUM_NOT_FOUND");
		});

		it("should return 400 for invalid ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/abc", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
		});

		it("should require admin auth", async () => {
			const { db } = createMockDb();
			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/42"),
				adminEnv(db),
			);
			expect(res.status).toBe(401);
		});
	});

	describe("create", () => {
		it("should create forum with all fields", async () => {
			const { db, calls } = createMockDb({
				runResults: { "INSERT INTO forums": { success: true, meta: { last_row_id: 123 } } },
				firstResults: {
					"SELECT id FROM forums WHERE id": { id: 0 }, // parent check
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 123, name: "New Forum" }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({
						name: "New Forum",
						description: "A new forum",
						type: "forum",
						parentId: 0,
						icon: "icon.png",
						displayOrder: 5,
						status: 1,
					}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data.name).toBe("New Forum");

			// Verify SQL was called
			const insertCall = calls.find((c) => c.sql.includes("INSERT INTO forums"));
			expect(insertCall).toBeDefined();
		});

		it("should create forum with only required fields", async () => {
			const { db } = createMockDb({
				runResults: { success: true, meta: { last_row_id: 456 } },
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 456, name: "Minimal" }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "Minimal" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data.name).toBe("Minimal");
			expect(body.data.type).toBe("forum"); // default
			expect(body.data.parentId).toBe(0); // default
		});

		it("should return 400 when name is missing", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should return 400 when name is empty string", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "   " }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 when name exceeds 100 chars", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "a".repeat(101) }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for invalid type", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "Test", type: "invalid" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid type");
		});

		it("should return 400 for invalid status", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "Test", status: 5 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should validate parent exists", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": null, // parent not found
				},
			});

			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "Test", parentId: 999 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Parent forum not found");
		});

		it("should return 400 for malformed JSON", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { Authorization: `Bearer ${token}` },
					body: "not json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});
	});

	describe("update", () => {
		it("should update forum with partial fields", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": { id: 42 },
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42, name: "Updated Name" }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "Updated Name", status: 0 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.name).toBe("Updated Name");

			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums"));
			expect(updateCall).toBeDefined();
			expect(updateCall?.sql).toContain("name = ?");
			expect(updateCall?.sql).toContain("status = ?");
		});

		it("should return 404 for non-existent forum", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": null },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/999", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "New" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should return 400 for empty body", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": { id: 42 } },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("No fields to update");
		});

		it("should return 400 for invalid type", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": { id: 42 } },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ type: "bad" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for empty name", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": { id: 42 } },
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should update description field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"FROM forums WHERE id": makeD1ForumRow({ id: 42, description: "updated" }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ description: "updated" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("description = ?");
		});

		it("should update icon field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ icon: "new-icon.png" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("icon = ?");
		});

		it("should update displayOrder field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ displayOrder: 5 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("display_order = ?");
		});

		it("should update parentId field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ parentId: 2 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("parent_id = ?");
		});

		it("should update type field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ type: "sub" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("type = ?");
		});

		it("should reject invalid status in update", async () => {
			const { db } = createMockDb({});

			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ status: 9 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("status must be 0 or 1");
		});

		it("should reject invalid forum ID", async () => {
			const { db } = createMockDb({});
			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/abc", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: "Test" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid forum ID");
		});

		it("should reject malformed JSON in update", async () => {
			const { db } = createMockDb({});
			const token = await createJwtForRole(1);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: "not json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should reject name longer than 100 characters", async () => {
			const { db } = createMockDb({});
			const token = await createJwtForRole(1);
			const longName = "a".repeat(101);
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { Authorization: `Bearer ${token}` },
					body: JSON.stringify({ name: longName }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("name must be at most 100 characters");
		});
	});

	describe("remove", () => {
		it("should delete forum with no threads", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": { id: 42 },
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 0 },
				},
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.deleted).toBe(true);
			expect(body.data.id).toBe(42);

			const deleteCall = calls.find((c) => c.sql.includes("DELETE FROM forums"));
			expect(deleteCall).toBeDefined();
		});

		it("should return 409 when forum has threads", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": { id: 42 },
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 5 },
				},
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe("FORUM_HAS_THREADS");
			expect(body.error.details.threadCount).toBe(5);
		});

		it("should return 404 for non-existent forum", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT id FROM forums WHERE id": null },
			});

			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/999", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should return 400 for invalid ID", async () => {
			const { db } = createMockDb();
			const token = await createJwtForRole(1);
			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/abc", {
					method: "DELETE",
					headers: { Authorization: `Bearer ${token}` },
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});
	});
});
