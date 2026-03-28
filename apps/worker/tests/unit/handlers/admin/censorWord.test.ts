import { describe, expect, it } from "bun:test";
import {
	batchDelete,
	create,
	getById,
	list,
	remove,
	test as testEndpoint,
	update,
} from "../../../../src/handlers/admin/censorWord";
import { createAdminRequest, createMockDb, makeEnv } from "../../../helpers";

// ─── Helpers ────────────────────────────────────────────────

function makeCensorWordRow(overrides?: Record<string, unknown>) {
	return {
		id: 1,
		find: "badword",
		replacement: "***",
		action: "replace",
		admin_id: 1,
		admin_name: "admin",
		created_at: 1711540800,
		...overrides,
	};
}

// ─── list ───────────────────────────────────────────────────

describe("admin censorWord handlers", () => {
	describe("list", () => {
		it("should require auth", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });

			const response = await list(
				new Request("https://api.example.com/api/admin/censor-words"),
				env,
			);

			expect(response.status).toBe(401);
		});

		it("should reject non-admin users", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/censor-words", undefined, 0);

			const response = await list(request, env);

			expect(response.status).toBe(403);
		});

		it("should return paginated results", async () => {
			const rows = [makeCensorWordRow({ id: 1 }), makeCensorWordRow({ id: 2, find: "evilword" })];
			const { db } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 2 } },
				allResults: { "SELECT * FROM censor_words": rows },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/censor-words");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			expect((body.data as unknown[]).length).toBe(2);
			expect((body.meta as Record<string, unknown>).total).toBe(2);
			expect((body.meta as Record<string, unknown>).page).toBe(1);
		});

		it("should filter by find (LIKE)", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 1 } },
				allResults: { "SELECT * FROM censor_words": [makeCensorWordRow()] },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/censor-words?find=bad");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("find LIKE ?");
			expect(countCall?.params[0]).toBe("%bad%");
		});

		it("should filter by action (exact)", async () => {
			const { db, calls } = createMockDb({
				firstResults: { "SELECT COUNT": { total: 1 } },
				allResults: { "SELECT * FROM censor_words": [makeCensorWordRow()] },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/censor-words?action=replace");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const countCall = calls.find((c) => c.sql.includes("COUNT"));
			expect(countCall?.sql).toContain("action = ?");
			expect(countCall?.params[0]).toBe("replace");
		});
	});

	// ─── getById ────────────────────────────────────────────

	describe("getById", () => {
		it("should return a censor word by id", async () => {
			const row = makeCensorWordRow({ id: 5 });
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM censor_words WHERE id": row },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/censor-words/5");

			const response = await getById(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.id).toBe(5);
			expect(data.find).toBe("badword");
		});

		it("should return 404 for non-existent word", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("GET", "/api/admin/censor-words/999");

			const response = await getById(request, env);

			expect(response.status).toBe(404);
		});
	});

	// ─── create ─────────────────────────────────────────────

	describe("create", () => {
		it("should create a valid censor word", async () => {
			const row = makeCensorWordRow();
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM censor_words WHERE find": null, // no duplicate
					"SELECT username FROM users WHERE id": { username: "admin" },
					"SELECT * FROM censor_words WHERE id": row, // re-fetch after INSERT
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words", {
				find: "badword",
				replacement: "***",
				action: "replace",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
		});

		it("should reject duplicate find", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM censor_words WHERE find": { id: 1 }, // duplicate exists
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words", {
				find: "badword",
			});

			const response = await create(request, env);

			expect(response.status).toBe(409);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("CENSOR_WORD_DUPLICATE");
		});

		it("should validate regex syntax in find", async () => {
			const { db } = createMockDb({
				firstResults: {
					"SELECT id FROM censor_words WHERE find": null,
					"SELECT username FROM users WHERE id": { username: "admin" },
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words", {
				find: "/[invalid(/",
				action: "replace",
			});

			const response = await create(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("CENSOR_WORD_INVALID");
		});

		it("should auto-fill admin_id and admin_name", async () => {
			const row = makeCensorWordRow({ find: "newword", admin_name: "superadmin" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM censor_words WHERE find": null,
					"SELECT username FROM users WHERE id": { username: "superadmin" },
					"SELECT * FROM censor_words WHERE id": row,
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words", {
				find: "newword",
				action: "replace",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
			const insertCall = calls.find((c) => c.sql.includes("INSERT"));
			expect(insertCall).toBeDefined();
			expect(insertCall?.params).toContain("superadmin");
		});

		it("should clear replacement when action is ban", async () => {
			const row = makeCensorWordRow({ find: "banme", action: "ban", replacement: "" });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT id FROM censor_words WHERE find": null,
					"SELECT username FROM users WHERE id": { username: "admin" },
					"SELECT * FROM censor_words WHERE id": row,
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words", {
				find: "banme",
				replacement: "should-be-cleared",
				action: "ban",
			});

			const response = await create(request, env);

			expect(response.status).toBe(201);
			const insertCall = calls.find((c) => c.sql.includes("INSERT"));
			expect(insertCall).toBeDefined();
			// The replacement param should be "" (cleared by beforeCreate)
			const replacementIdx = insertCall?.params.indexOf("should-be-cleared");
			expect(replacementIdx).toBe(-1);
			expect(insertCall?.params).toContain("");
		});
	});

	// ─── update ─────────────────────────────────────────────

	describe("update", () => {
		it("should update valid fields", async () => {
			const existing = makeCensorWordRow({ id: 3 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM censor_words WHERE id": existing,
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/censor-words/3", {
				replacement: "****",
				action: "replace",
			});

			const response = await update(request, env);

			expect(response.status).toBe(200);
		});

		it("should validate regex when find is updated", async () => {
			const existing = makeCensorWordRow({ id: 3 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM censor_words WHERE id": existing,
					"SELECT id FROM censor_words WHERE find": null,
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/censor-words/3", {
				find: "/[broken(/",
			});

			const response = await update(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("CENSOR_WORD_INVALID");
		});

		it("should check duplicate when find is updated", async () => {
			const existing = makeCensorWordRow({ id: 3 });
			const { db } = createMockDb({
				firstResults: {
					"SELECT * FROM censor_words WHERE id": existing,
					"SELECT id FROM censor_words WHERE find": { id: 5 }, // different id = duplicate
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/censor-words/3", {
				find: "existing",
			});

			const response = await update(request, env);

			expect(response.status).toBe(409);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("CENSOR_WORD_DUPLICATE");
		});

		it("should clear replacement when action changes to ban", async () => {
			const existing = makeCensorWordRow({ id: 3 });
			const { db, calls } = createMockDb({
				firstResults: {
					"SELECT * FROM censor_words WHERE id": existing,
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("PATCH", "/api/admin/censor-words/3", {
				action: "ban",
			});

			const response = await update(request, env);

			expect(response.status).toBe(200);
			const updateCall = calls.find((c) => c.sql.includes("UPDATE"));
			expect(updateCall).toBeDefined();
			// Should include replacement="" in the UPDATE due to ban action
			expect(updateCall?.params).toContain("");
		});
	});

	// ─── remove ─────────────────────────────────────────────

	describe("remove", () => {
		it("should delete a censor word", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM censor_words WHERE id": makeCensorWordRow({ id: 7 }) },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("DELETE", "/api/admin/censor-words/7");

			const response = await remove(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.deleted).toBe(true);
			expect(data.id).toBe(7);
		});

		it("should return 404 for non-existent word", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("DELETE", "/api/admin/censor-words/999");

			const response = await remove(request, env);

			expect(response.status).toBe(404);
		});
	});

	// ─── batchDelete ────────────────────────────────────────

	describe("batchDelete", () => {
		it("should batch delete censor words", async () => {
			const { db } = createMockDb({
				firstResults: { "SELECT * FROM censor_words WHERE id": makeCensorWordRow() },
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words/batch-delete", {
				ids: [1, 2, 3],
			});

			const response = await batchDelete(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.deleted).toBe(true);
		});

		it("should reject empty ids array", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words/batch-delete", {
				ids: [],
			});

			const response = await batchDelete(request, env);

			expect(response.status).toBe(400);
		});
	});

	// ─── test endpoint ──────────────────────────────────────

	describe("test", () => {
		it("should test content against censor rules", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, find, replacement, action FROM censor_words": [
						{ id: 1, find: "badword", replacement: "***", action: "replace" },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words/test", {
				content: "this contains a badword in it",
			});

			const response = await testEndpoint(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.matched).toBe(true);
			expect(data.action).toBe("replace");
			expect((data.matches as unknown[]).length).toBe(1);
			expect(data.filtered).toContain("***");
		});

		it("should return no match for clean content", async () => {
			const { db } = createMockDb({
				allResults: {
					"SELECT id, find, replacement, action FROM censor_words": [
						{ id: 1, find: "badword", replacement: "***", action: "replace" },
					],
				},
			});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words/test", {
				content: "this is clean content",
			});

			const response = await testEndpoint(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.matched).toBe(false);
		});

		it("should require non-empty content string", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words/test", {
				content: "",
			});

			const response = await testEndpoint(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_BODY");
		});

		it("should reject missing content field", async () => {
			const { db } = createMockDb({});
			const env = makeEnv({ DB: db });
			const request = await createAdminRequest("POST", "/api/admin/censor-words/test", {});

			const response = await testEndpoint(request, env);

			expect(response.status).toBe(400);
		});
	});
});
