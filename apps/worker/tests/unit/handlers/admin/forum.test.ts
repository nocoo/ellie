import { describe, expect, it } from "vitest";
import {
	create,
	getById,
	list,
	merge,
	remove,
	reorder,
	update,
} from "../../../../src/handlers/admin/forum";
import { createMockDb, makeD1ForumRow, makeEnv } from "../../../helpers";

describe("admin forum handlers", () => {
	const adminEnv = (db: D1Database) => makeEnv({ DB: db });

	// ─── list ────────────────────────────────────────────────

	describe("list", () => {
		it("should return all forums (no pagination)", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT * FROM forums": [
						makeD1ForumRow({ id: 1, status: 1, name: "Visible" }),
						makeD1ForumRow({ id: 2, status: 0, name: "Hidden" }),
					],
				},
			});

			const res = await list(new Request("https://api.example.com/api/admin/forums"), adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toHaveLength(2);
			expect(body.data[0].name).toBe("Visible");
			expect(body.data[1].name).toBe("Hidden");
		});

		it("should return empty array when no forums", async () => {
			const { db } = createMockDb();
			const res = await list(new Request("https://api.example.com/api/admin/forums"), adminEnv(db));
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data).toEqual([]);
		});

		it("should map D1 rows to camelCase", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT * FROM forums": [
						makeD1ForumRow({ id: 5, parent_id: 2, display_order: 3, last_thread_id: 99 }),
					],
				},
			});

			const res = await list(new Request("https://api.example.com/api/admin/forums"), adminEnv(db));
			const body = await res.json();

			expect(body.data[0].parentId).toBe(2);
			expect(body.data[0].displayOrder).toBe(3);
			expect(body.data[0].lastThreadId).toBe(99);
		});
	});

	// ─── getById ─────────────────────────────────────────────

	describe("getById", () => {
		it("should return forum by ID", async () => {
			const forumRow = makeD1ForumRow({ id: 42, name: "Test Forum" });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM forums WHERE id": forumRow },
			});

			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/42"),
				adminEnv(db),
			);
			const body = await res.json();

			expect(res.status).toBe(200);
			expect(body.data.id).toBe(42);
			expect(body.data.name).toBe("Test Forum");
		});

		it("should return 404 for non-existent forum", async () => {
			const { db } = createMockDb();
			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/999"),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("FORUM_NOT_FOUND");
		});

		it("should return 400 for invalid ID", async () => {
			const { db } = createMockDb();
			const res = await getById(
				new Request("https://api.example.com/api/admin/forums/abc"),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
		});
	});

	// ─── create ──────────────────────────────────────────────

	describe("create", () => {
		it("should create forum with all fields", async () => {
			const { db, calls } = createMockDb({
				runResults: { "INSERT INTO forums": { success: true, meta: { last_row_id: 123 } } },
				firstResults: {
					"SELECT id FROM forums WHERE id": { id: 0 }, // parent check
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 123, name: "New Forum" }),
				},
			});

			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
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

			const insertCall = calls.find((c) => c.sql.includes("INSERT INTO forums"));
			expect(insertCall).toBeDefined();
		});

		it("should create forum with only required fields (defaults applied)", async () => {
			const { db } = createMockDb({
				runResults: { success: true, meta: { last_row_id: 456 } },
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({
						id: 456,
						name: "Minimal",
						type: "forum",
						parent_id: 0,
					}),
				},
			});

			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "Minimal" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data.name).toBe("Minimal");
			expect(body.data.type).toBe("forum");
			expect(body.data.parentId).toBe(0);
		});

		it("should return 400 when name is missing", async () => {
			const { db } = createMockDb();
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should return 400 when name is empty/whitespace", async () => {
			const { db } = createMockDb();
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "   " }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 when name exceeds 100 chars", async () => {
			const { db } = createMockDb();
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "a".repeat(101) }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for invalid type", async () => {
			const { db } = createMockDb();
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
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
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "Test", status: 5 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should validate parent forum exists (beforeCreate hook)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM forums WHERE id": null, // parent not found
				},
			});

			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
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
			const res = await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "not json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});

		it("should initialize counter columns via beforeCreate", async () => {
			const { db, calls } = createMockDb({
				runResults: { "INSERT INTO forums": { success: true, meta: { last_row_id: 10 } } },
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 10, name: "New" }),
				},
			});

			await create(
				new Request("https://api.example.com/api/admin/forums", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "New" }),
				}),
				adminEnv(db),
			);

			// The INSERT should include counter columns initialized by beforeCreate
			const insertCall = calls.find((c) => c.sql.includes("INSERT INTO forums"));
			expect(insertCall).toBeDefined();
			expect(insertCall?.sql).toContain("threads");
			expect(insertCall?.sql).toContain("posts");
			expect(insertCall?.sql).toContain("last_thread_id");
			expect(insertCall?.sql).toContain("last_post_at");
			expect(insertCall?.sql).toContain("last_poster");
		});
	});

	// ─── update ──────────────────────────────────────────────

	describe("update", () => {
		it("should update forum with partial fields", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42, name: "Updated Name" }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
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
			const { db } = createMockDb();

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/999", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "New" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should return 400 for empty body (no recognized fields)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("At least one field must be provided");
		});

		it("should return 400 for invalid type", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: "bad" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for empty name", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for name longer than 100 chars", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "a".repeat(101) }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("name must be at most 100 characters");
		});

		it("should reject invalid status in update", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ status: 9 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("status must be 0 or 1");
		});

		it("should update description field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42, description: "updated" }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
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
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
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
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
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
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
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
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ type: "sub" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("type = ?");
		});

		it("should update visibility field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ visibility: "members" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("visibility = ?");
		});

		it("should reject invalid visibility value", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ visibility: "secret" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should update moderators field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ moderators: "alice,bob" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("moderators = ?");
		});

		it("should reject non-string moderators value", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ moderators: 123 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should update moderatorIds field", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ moderatorIds: "1,2,3" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE forums SET"));
			expect(updateCall?.sql).toContain("moderator_ids = ?");
		});

		it("should reject invalid moderatorIds format", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ moderatorIds: "abc,def" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should accept empty moderatorIds", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
				},
			});

			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ moderatorIds: "" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
		});

		it("should reject invalid forum ID (non-numeric)", async () => {
			const { db } = createMockDb();
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/abc", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name: "Test" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid forum ID");
		});

		it("should reject malformed JSON", async () => {
			const { db } = createMockDb();
			const res = await update(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: "not json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("INVALID_BODY");
		});
	});

	// ─── remove ──────────────────────────────────────────────

	describe("remove", () => {
		it("should delete forum with no threads", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 0 },
				},
			});

			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "DELETE",
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

		it("should return 409 when forum has threads (beforeDelete hook)", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 5 },
				},
			});

			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "DELETE",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(409);
			const body = await res.json();
			expect(body.error.code).toBe("FORUM_HAS_THREADS");
			expect(body.error.details.threadCount).toBe(5);
		});

		it("should include CORS headers in hook error response", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 42 }),
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 5 },
				},
			});

			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/42", {
					method: "DELETE",
					headers: {
						Origin: "http://localhost:3000",
					},
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(409);
			expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});

		it("should return 404 for non-existent forum", async () => {
			const { db } = createMockDb();

			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/999", {
					method: "DELETE",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
		});

		it("should return 400 for invalid ID", async () => {
			const { db } = createMockDb();
			const res = await remove(
				new Request("https://api.example.com/api/admin/forums/abc", {
					method: "DELETE",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});
	});

	// ─── merge ───────────────────────────────────────────────

	describe("merge", () => {
		it("should merge source forum into target", async () => {
			const { db, batchCalls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 10 }), // source
					"SELECT id FROM forums WHERE id": { id: 20 }, // target
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 3 },
					"SELECT COUNT(*) as cnt FROM posts": { cnt: 15 },
				},
			});

			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/10/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetForumId: 20 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.merged).toBe(true);
			expect(body.data.sourceForumId).toBe(10);
			expect(body.data.targetForumId).toBe(20);
			expect(body.data.threadsMoved).toBe(3);
			expect(body.data.postsMoved).toBe(15);

			// Should call batch for the 4 statements
			expect(batchCalls).toHaveLength(1);
		});

		it("should return 400 when targetForumId is missing", async () => {
			const { db } = createMockDb();
			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/10/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("targetForumId is required");
		});

		it("should return 400 when targetForumId is not a number", async () => {
			const { db } = createMockDb();
			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/10/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetForumId: "abc" }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("targetForumId is required");
		});

		it("should reject self-merge (source === target)", async () => {
			const { db } = createMockDb();
			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/10/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetForumId: 10 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Cannot merge a forum into itself");
		});

		it("should return 404 when source forum does not exist", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": null, // source not found
				},
			});

			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/999/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetForumId: 20 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(404);
			const body = await res.json();
			expect(body.error.code).toBe("FORUM_NOT_FOUND");
		});

		it("should return 400 when target forum does not exist", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 10 }), // source exists
					"SELECT id FROM forums WHERE id": null, // target not found
				},
			});

			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/10/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetForumId: 20 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Target forum not found");
		});

		it("should return 400 for invalid source ID (non-numeric)", async () => {
			const { db } = createMockDb();
			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/abc/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ targetForumId: 20 }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid forum ID");
		});

		it("should return 400 for malformed JSON", async () => {
			const { db } = createMockDb();
			const res = await merge(
				new Request("https://api.example.com/api/admin/forums/10/merge", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "not json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid JSON body");
		});
	});

	// ─── reorder ─────────────────────────────────────────────

	describe("reorder", () => {
		it("should batch reorder forums", async () => {
			const { db, batchCalls } = createMockDb();
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						orders: [
							{ id: 1, displayOrder: 0 },
							{ id: 2, displayOrder: 1 },
							{ id: 3, displayOrder: 2 },
						],
					}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.updated).toBe(true);
			expect(body.data.count).toBe(3);

			expect(batchCalls).toHaveLength(1);
		});

		it("should return 400 for empty orders array", async () => {
			const { db } = createMockDb();
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ orders: [] }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("orders must be a non-empty array");
		});

		it("should return 400 when orders is missing", async () => {
			const { db } = createMockDb();
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("orders must be a non-empty array");
		});

		it("should return 400 when order item has invalid shape", async () => {
			const { db } = createMockDb();
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						orders: [{ id: "abc", displayOrder: 0 }],
					}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Each order must have numeric id and displayOrder");
		});

		it("should return 400 when order item missing displayOrder", async () => {
			const { db } = createMockDb();
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						orders: [{ id: 1 }],
					}),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 when exceeding max reorder items (200)", async () => {
			const { db } = createMockDb();
			const orders = Array.from({ length: 201 }, (_, i) => ({
				id: i + 1,
				displayOrder: i,
			}));
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ orders }),
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		});

		it("should return 400 for malformed JSON", async () => {
			const { db } = createMockDb();
			const res = await reorder(
				new Request("https://api.example.com/api/admin/forums/reorder", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: "not json",
				}),
				adminEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.details.message).toBe("Invalid JSON body");
		});
	});

	// ─── F3-c: audit instrumentation ─────────────────────────────────

	describe("F3-c audit instrumentation", () => {
		function actorReq(method: string, path: string, body?: unknown): Request {
			const headers: Record<string, string> = {
				"X-API-Key": "test-api-key",
				"Content-Type": "application/json",
				"X-Admin-Actor-Email": "alice@example.com",
				"X-Admin-Actor-Name": "Alice",
				"CF-Connecting-IP": "5.6.7.8",
			};
			return new Request(`https://api.example.com${path}`, {
				method,
				headers,
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		}

		function findAuditInsert(calls: { sql: string; params: unknown[] }[]) {
			return calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		}

		it("POST writes forum.create with name/type/parentId and descriptionLength only", async () => {
			const created = makeD1ForumRow({ id: 99, name: "New Forum" });
			const { db, calls } = createMockDb({
				firstResults: { "SELECT * FROM forums WHERE id": created },
				runResults: { "INSERT INTO forums": { meta: { last_row_id: 99 } } },
			});
			const res = await create(
				actorReq("POST", "/api/admin/forums", {
					name: "New Forum",
					type: "forum",
					description: "long description text",
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(201);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("forum.create");
			expect(insert?.params[3]).toBe("forum");
			expect(insert?.params[4]).toBe(99);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.name).toBe("New Forum");
			expect(details.descriptionLength).toBe("long description text".length);
			// Raw description text MUST NOT leak.
			expect(JSON.stringify(details)).not.toContain("long description text");
		});

		it("PATCH writes forum.update with description length-only", async () => {
			const existing = makeD1ForumRow({ id: 5, description: "old desc" });
			const updated = makeD1ForumRow({ id: 5, description: "much longer new desc" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": existing,
					"SELECT id, parent_id, name, description": updated,
				},
			});
			const res = await update(
				actorReq("PATCH", "/api/admin/forums/5", { description: "much longer new desc" }),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.changedFields).toEqual(["description"]);
			expect(details.descriptionLengthBefore).toBe("old desc".length);
			expect(details.descriptionLengthAfter).toBe("much longer new desc".length);
			expect(details.before).toBeUndefined();
			expect(JSON.stringify(details)).not.toContain("much longer new desc");
		});

		it("PATCH no-op (same value) does NOT write audit row", async () => {
			const existing = makeD1ForumRow({ id: 5, name: "Same" });
			const updated = makeD1ForumRow({ id: 5, name: "Same" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": existing,
					"SELECT id, parent_id": updated,
				},
			});
			const res = await update(
				actorReq("PATCH", "/api/admin/forums/5", { name: "Same" }),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});

		it("DELETE writes forum.delete", async () => {
			const existing = makeD1ForumRow({ id: 7, name: "Doomed" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": existing,
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 0 },
				},
			});
			const res = await remove(actorReq("DELETE", "/api/admin/forums/7"), adminEnv(db));
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("forum.delete");
			expect(insert?.params[4]).toBe(7);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.name).toBe("Doomed");
		});

		it("DELETE refused (forum has threads) does NOT write audit row", async () => {
			const existing = makeD1ForumRow({ id: 7 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": existing,
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 5 },
				},
			});
			const res = await remove(actorReq("DELETE", "/api/admin/forums/7"), adminEnv(db));
			expect(res.status).toBe(409);
			expect(findAuditInsert(calls)).toBeUndefined();
		});

		it("merge writes forum.merge with thread/post counts", async () => {
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM forums WHERE id": makeD1ForumRow({ id: 3 }),
					"SELECT id FROM forums WHERE id": { id: 4 },
					"SELECT COUNT(*) as cnt FROM threads": { cnt: 2 },
					"SELECT COUNT(*) as cnt FROM posts": { cnt: 10 },
				},
			});
			const res = await merge(
				actorReq("POST", "/api/admin/forums/3/merge", { targetForumId: 4 }),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert?.params[2]).toBe("forum.merge");
			expect(insert?.params[4]).toBe(3);
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.sourceForumId).toBe(3);
			expect(details.targetForumId).toBe(4);
			expect(details.threadsMoved).toBe(2);
			expect(details.postsMoved).toBe(10);
			// Actor email comes from X-Admin-Actor-Email; must NOT fall back to system.
			expect(details.actorEmail).toBe("alice@example.com");
		});

		it("reorder writes one forum.reorder row with only changed rows (id, before, after)", async () => {
			// 3 incoming: id 1 changes (10→11), id 2 unchanged (20→20),
			// id 99 missing in DB. Audit MUST contain only id 1.
			const { db, calls } = createMockDb({
				allResults: {
					"SELECT id, display_order FROM forums WHERE id IN": [
						{ id: 1, display_order: 10 },
						{ id: 2, display_order: 20 },
					],
				},
			});
			const res = await reorder(
				actorReq("POST", "/api/admin/forums/reorder", {
					orders: [
						{ id: 1, displayOrder: 11 },
						{ id: 2, displayOrder: 20 },
						{ id: 99, displayOrder: 30 },
					],
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("forum.reorder");
			expect(insert?.params[4]).toBeNull();
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.count).toBe(1);
			expect(details.orders).toEqual([{ id: 1, before: 10, after: 11 }]);
		});

		it("reorder no-op (all unchanged) does NOT write audit row", async () => {
			const { db, calls } = createMockDb({
				allResults: {
					"SELECT id, display_order FROM forums WHERE id IN": [
						{ id: 1, display_order: 10 },
						{ id: 2, display_order: 20 },
					],
				},
			});
			const res = await reorder(
				actorReq("POST", "/api/admin/forums/reorder", {
					orders: [
						{ id: 1, displayOrder: 10 },
						{ id: 2, displayOrder: 20 },
					],
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});

		it("reorder with all-missing ids does NOT write audit row", async () => {
			const { db, calls } = createMockDb({
				allResults: { "SELECT id, display_order FROM forums WHERE id IN": [] },
			});
			const res = await reorder(
				actorReq("POST", "/api/admin/forums/reorder", {
					orders: [{ id: 999, displayOrder: 1 }],
				}),
				adminEnv(db),
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});
	});
});
