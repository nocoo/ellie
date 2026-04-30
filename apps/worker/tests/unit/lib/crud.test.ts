import { describe, expect, it, vi } from "vitest";
import type { EntityConfig } from "../../../src/lib/crud";
import {
	createBatchDeleteHandler,
	createCreateHandler,
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../../src/lib/crud";
import { createMockDb, makeEnv } from "../../helpers";

// ─── Test fixtures ─────────────────────────────────────────

const testMapper = (row: Record<string, unknown>) => ({
	id: row.id,
	name: row.name,
	value: row.some_value,
});

function makeTestConfig(overrides?: Partial<EntityConfig>): EntityConfig {
	return {
		table: "test_items",
		entityName: "TEST_ITEM",
		auth: "admin",
		columns: "id, name, some_value",
		mapper: testMapper,
		notFoundCode: "TEST_ITEM_NOT_FOUND",
		filters: [
			{ param: "name", column: "name", type: "like" },
			{ param: "status", column: "status", type: "exact", parse: "int" },
			{ param: "active", column: "active", type: "exact", parse: "boolean" },
		],
		createFields: [
			{
				name: "name",
				column: "name",
				required: true,
				validate: (v) => (typeof v !== "string" ? "name must be a string" : null),
			},
			{ name: "value", column: "some_value", default: 0 },
		],
		updateFields: [
			{
				name: "name",
				column: "name",
				validate: (v) => (typeof v !== "string" ? "name must be a string" : null),
			},
			{ name: "value", column: "some_value" },
		],
		canDelete: true,
		batchDelete: true,
		batchLimit: 5,
		...overrides,
	};
}

const testRow = { id: 1, name: "Item One", some_value: 42 };

function makeRequest(path: string, opts?: RequestInit): Request {
	return new Request(`https://api.example.com${path}`, opts);
}

function makeJsonRequest(path: string, body: unknown, method = "POST"): Request {
	return new Request(`https://api.example.com${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

// ─── createListHandler ─────────────────────────────────────

describe("createListHandler", () => {
	it("should return paginated results with default page=1, limit=20", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items"), env);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual([{ id: 1, name: "Item One", value: 42 }]);
		expect(body.meta.total).toBe(1);
		expect(body.meta.page).toBe(1);
		expect(body.meta.limit).toBe(20);
	});

	it("should respect custom page and limit params", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 50 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items?page=3&limit=10"), env);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.meta.page).toBe(3);
		expect(body.meta.limit).toBe(10);
		// offset should be (3-1)*10 = 20
		const selectCall = calls.find((c) => c.sql.includes("LIMIT"));
		expect(selectCall).toBeDefined();
		expect(selectCall?.params).toContain(10); // limit
		expect(selectCall?.params).toContain(20); // offset
	});

	it("should clamp limit to MAX_PAGE_SIZE (100)", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items?page=1&limit=999"), env);
		const body = await res.json();

		expect(body.meta.limit).toBe(100);
	});

	it("should clamp limit minimum to 1", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items?page=1&limit=0"), env);
		const body = await res.json();

		expect(body.meta.limit).toBe(1);
	});

	it("should return error for invalid page number (page < 1)", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items?page=0"), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("should return error for NaN page number", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items?page=abc"), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("should return unpaginated results when listPaginated=false", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig({ listPaginated: false }));

		const res = await handler(makeRequest("/api/admin/test-items"), env);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual([{ id: 1, name: "Item One", value: 42 }]);
		// No pagination meta
		expect(body.meta.total).toBeUndefined();
		expect(body.meta.page).toBeUndefined();
	});

	it("should return empty array when no results", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items"), env);
		const body = await res.json();

		expect(body.data).toEqual([]);
		expect(body.meta.total).toBe(0);
	});

	it("should apply 'like' filter", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?name=foo"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE name LIKE ?");
		expect(countCall?.params).toContain("%foo%");
	});

	it("should apply 'int' filter with valid integer", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?status=2"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE status = ?");
		expect(countCall?.params).toContain(2);
	});

	it("should skip 'int' filter with non-numeric value", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?status=abc"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).not.toContain("WHERE");
	});

	it("should apply 'boolean' filter with true", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?active=true"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE active = 1");
	});

	it("should apply 'boolean' filter with '1'", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?active=1"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE active = 1");
	});

	it("should apply 'boolean' filter with false", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?active=false"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE active = 0");
	});

	it("should apply 'boolean' filter with '0'", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?active=0"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE active = 0");
	});

	it("should ignore boolean filter with invalid value", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?active=maybe"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).not.toContain("WHERE");
	});

	it("should skip filters with empty string value", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?name="), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).not.toContain("WHERE");
	});

	it("should combine multiple filters with AND", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items?name=foo&status=1"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE name LIKE ? AND status = ?");
	});

	it("should use custom listSort when provided", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig({ listSort: "name ASC" }));

		await handler(makeRequest("/api/admin/test-items"), env);

		const selectCall = calls.find((c) => c.sql.includes("ORDER BY"));
		expect(selectCall?.sql).toContain("ORDER BY name ASC");
	});

	it("should use default sort 'id DESC' when listSort not provided", async () => {
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		await handler(makeRequest("/api/admin/test-items"), env);

		const selectCall = calls.find((c) => c.sql.includes("ORDER BY"));
		expect(selectCall?.sql).toContain("ORDER BY id DESC");
	});

	it("should apply exact filter (no parse) as string equality", async () => {
		const config = makeTestConfig({
			filters: [{ param: "code", column: "code", type: "exact" }],
		});
		const { db, calls } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 1 } },
			allResults: { "SELECT id, name, some_value FROM test_items": [testRow] },
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(config);

		await handler(makeRequest("/api/admin/test-items?code=ABC"), env);

		const countCall = calls.find((c) => c.sql.includes("COUNT"));
		expect(countCall?.sql).toContain("WHERE code = ?");
		expect(countCall?.params).toContain("ABC");
	});

	it("should handle no filters defined", async () => {
		const config = makeTestConfig({ filters: undefined });
		const { db } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(config);

		const res = await handler(makeRequest("/api/admin/test-items"), env);
		expect(res.status).toBe(200);
	});

	it("should handle countResult returning null (default total to 0)", async () => {
		const { db } = createMockDb({
			// firstResults returns null by default when no match
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items"), env);
		const body = await res.json();

		expect(body.meta.total).toBe(0);
	});

	it("should forward Origin header as CORS origin", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT COUNT": { total: 0 } },
			allResults: {},
		});
		const env = makeEnv({ DB: db });
		const handler = createListHandler(makeTestConfig());

		const req = new Request("https://api.example.com/api/admin/test-items", {
			headers: { Origin: "http://localhost:3000" },
		});
		const res = await handler(req, env);

		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
	});
});

// ─── createGetByIdHandler ──────────────────────────────────

describe("createGetByIdHandler", () => {
	it("should return mapped entity on success", async () => {
		const { db } = createMockDb({
			firstResults: { "SELECT id, name, some_value FROM test_items WHERE id": testRow },
		});
		const env = makeEnv({ DB: db });
		const handler = createGetByIdHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items/1"), env);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual({ id: 1, name: "Item One", value: 42 });
	});

	it("should return 404 when entity not found", async () => {
		const { db } = createMockDb(); // firstResults returns null by default
		const env = makeEnv({ DB: db });
		const handler = createGetByIdHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items/999"), env);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("TEST_ITEM_NOT_FOUND");
	});

	it("should use default NOT_FOUND code when notFoundCode not set", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createGetByIdHandler(makeTestConfig({ notFoundCode: undefined }));

		const res = await handler(makeRequest("/api/admin/test-items/999"), env);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("NOT_FOUND");
	});

	it("should return 400 for invalid (non-numeric) ID", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createGetByIdHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items/abc"), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
		expect(body.error.details.message).toContain("test_item");
	});
});

// ─── createCreateHandler ───────────────────────────────────

describe("createCreateHandler", () => {
	it("should create entity and return 201", async () => {
		const { db } = createMockDb({
			runResults: {
				"INSERT INTO test_items": { success: true, meta: { last_row_id: 10, changes: 1 } },
			},
			firstResults: {
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 10,
					name: "New Item",
					some_value: 5,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items", { name: "New Item", value: 5 }),
			env,
		);
		const body = await res.json();

		expect(res.status).toBe(201);
		expect(body.data).toEqual({ id: 10, name: "New Item", value: 5 });
	});

	it("should apply default value when field not provided", async () => {
		const { db, calls } = createMockDb({
			runResults: {
				"INSERT INTO test_items": { success: true, meta: { last_row_id: 11, changes: 1 } },
			},
			firstResults: {
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 11,
					name: "Defaults",
					some_value: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		await handler(makeJsonRequest("/api/admin/test-items", { name: "Defaults" }), env);

		const insertCall = calls.find((c) => c.sql.includes("INSERT"));
		expect(insertCall).toBeDefined();
		// The default value 0 should be used for some_value
		expect(insertCall?.params).toContain(0);
	});

	it("should return 400 when required field is missing", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		const res = await handler(makeJsonRequest("/api/admin/test-items", { value: 5 }), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details.message).toContain("name is required");
	});

	it("should return 400 when required field is empty string", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items", { name: "", value: 5 }),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.details.message).toContain("name is required");
	});

	it("should return 400 when required field is null", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items", { name: null, value: 5 }),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.details.message).toContain("name is required");
	});

	it("should return 400 when validation fails", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		const res = await handler(makeJsonRequest("/api/admin/test-items", { name: 12345 }), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details.message).toBe("name must be a string");
	});

	it("should return 400 for invalid JSON body", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig());

		const req = new Request("https://api.example.com/api/admin/test-items", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json{{{",
		});
		const res = await handler(req, env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details.message).toBe("Invalid JSON body");
	});

	it("should return 500 when createFields not configured", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig({ createFields: undefined }));

		const res = await handler(makeJsonRequest("/api/admin/test-items", { name: "Test" }), env);

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("INTERNAL_ERROR");
	});

	it("should call beforeCreate hook and abort if it returns a Response", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const beforeCreate = vi.fn(async () => {
			return new Response(JSON.stringify({ error: { code: "HOOK_ERROR", message: "Blocked" } }), {
				status: 403,
			});
		});
		const handler = createCreateHandler(makeTestConfig({ beforeCreate }));

		const res = await handler(makeJsonRequest("/api/admin/test-items", { name: "Test" }), env);

		expect(res.status).toBe(403);
		expect(beforeCreate).toHaveBeenCalledTimes(1);
	});

	it("should proceed when beforeCreate hook returns undefined", async () => {
		const { db } = createMockDb({
			runResults: {
				"INSERT INTO test_items": { success: true, meta: { last_row_id: 20, changes: 1 } },
			},
			firstResults: {
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 20,
					name: "Hooked",
					some_value: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const beforeCreate = vi.fn(async () => undefined);
		const handler = createCreateHandler(makeTestConfig({ beforeCreate }));

		const res = await handler(makeJsonRequest("/api/admin/test-items", { name: "Hooked" }), env);

		expect(res.status).toBe(201);
		expect(beforeCreate).toHaveBeenCalledTimes(1);
	});

	it("should call afterCreate hook with new id, data, env", async () => {
		const afterCreate = vi.fn(async () => {});
		const { db } = createMockDb({
			runResults: {
				"INSERT INTO test_items": { success: true, meta: { last_row_id: 30, changes: 1 } },
			},
			firstResults: {
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 30,
					name: "After",
					some_value: 7,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig({ afterCreate }));

		await handler(makeJsonRequest("/api/admin/test-items", { name: "After", value: 7 }), env);

		expect(afterCreate).toHaveBeenCalledTimes(1);
		const [id, data, envArg] = afterCreate.mock.calls[0];
		expect(id).toBe(30);
		expect(data).toEqual({ name: "After", some_value: 7 });
		expect(envArg).toBe(env);
	});

	it("should not call afterCreate when last_row_id is falsy (0)", async () => {
		const afterCreate = vi.fn(async () => {});
		const { db } = createMockDb({
			runResults: {
				"INSERT INTO test_items": { success: true, meta: { last_row_id: 0, changes: 1 } },
			},
			firstResults: {
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 0,
					name: "Zero",
					some_value: 0,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createCreateHandler(makeTestConfig({ afterCreate }));

		await handler(makeJsonRequest("/api/admin/test-items", { name: "Zero" }), env);

		expect(afterCreate).not.toHaveBeenCalled();
	});
});

// ─── createUpdateHandler ───────────────────────────────────

describe("createUpdateHandler", () => {
	it("should update entity and return mapped result", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Old", some_value: 10 },
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 1,
					name: "Updated",
					some_value: 10,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/1", { name: "Updated" }, "PATCH"),
			env,
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual({ id: 1, name: "Updated", value: 10 });
	});

	it("should return 404 when entity not found", async () => {
		const { db } = createMockDb(); // fetchRowFull returns null
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/999", { name: "Nope" }, "PATCH"),
			env,
		);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("TEST_ITEM_NOT_FOUND");
	});

	it("should return 400 when no fields provided (empty body update)", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Old", some_value: 10 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig());

		const res = await handler(makeJsonRequest("/api/admin/test-items/1", {}, "PATCH"), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details.message).toContain("At least one field");
	});

	it("should return 400 when validation fails", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Old", some_value: 10 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/1", { name: 999 }, "PATCH"),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.details.message).toBe("name must be a string");
	});

	it("should return 400 for invalid ID", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/abc", { name: "X" }, "PATCH"),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("should return 400 for invalid JSON body", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig());

		const req = new Request("https://api.example.com/api/admin/test-items/1", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: "bad{json",
		});
		const res = await handler(req, env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("should return 500 when updateFields not configured", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig({ updateFields: undefined }));

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/1", { name: "X" }, "PATCH"),
			env,
		);

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe("INTERNAL_ERROR");
	});

	it("should call beforeUpdate hook and abort if it returns a Response", async () => {
		const beforeUpdate = vi.fn(async () => {
			return new Response(JSON.stringify({ error: { code: "HOOK_BLOCK", message: "Nope" } }), {
				status: 409,
			});
		});
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Old", some_value: 10 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig({ beforeUpdate }));

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/1", { name: "New" }, "PATCH"),
			env,
		);

		expect(res.status).toBe(409);
		expect(beforeUpdate).toHaveBeenCalledTimes(1);
		const [id, data, existing, envArg] = beforeUpdate.mock.calls[0];
		expect(id).toBe(1);
		expect(data).toEqual({ name: "New" });
		expect(existing).toEqual({ id: 1, name: "Old", some_value: 10 });
		expect(envArg).toBe(env);
	});

	it("should proceed when beforeUpdate returns undefined", async () => {
		const beforeUpdate = vi.fn(async () => undefined);
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Old", some_value: 10 },
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 1,
					name: "Updated",
					some_value: 10,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig({ beforeUpdate }));

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/1", { name: "Updated" }, "PATCH"),
			env,
		);

		expect(res.status).toBe(200);
	});

	it("should call afterUpdate hook with correct args", async () => {
		const afterUpdate = vi.fn(async () => {});
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Old", some_value: 10 },
				"SELECT id, name, some_value FROM test_items WHERE id": {
					id: 1,
					name: "New",
					some_value: 10,
				},
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createUpdateHandler(makeTestConfig({ afterUpdate }));

		await handler(makeJsonRequest("/api/admin/test-items/1", { name: "New" }, "PATCH"), env);

		expect(afterUpdate).toHaveBeenCalledTimes(1);
		const [id, data, existing, envArg] = afterUpdate.mock.calls[0];
		expect(id).toBe(1);
		expect(data).toEqual({ name: "New" });
		expect(existing).toEqual({ id: 1, name: "Old", some_value: 10 });
		expect(envArg).toBe(env);
	});
});

// ─── createRemoveHandler ───────────────────────────────────

describe("createRemoveHandler", () => {
	it("should delete entity and return { deleted: true, id }", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Doomed", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items/1", { method: "DELETE" }), env);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data).toEqual({ deleted: true, id: 1 });
	});

	it("should return 404 when entity not found", async () => {
		const { db } = createMockDb(); // fetchRowFull returns null
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items/999", { method: "DELETE" }), env);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("TEST_ITEM_NOT_FOUND");
	});

	it("should return 400 for invalid ID", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig());

		const res = await handler(makeRequest("/api/admin/test-items/abc", { method: "DELETE" }), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_REQUEST");
	});

	it("should return 403 when canDelete is false", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig({ canDelete: false }));

		const res = await handler(makeRequest("/api/admin/test-items/1", { method: "DELETE" }), env);

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe("FORBIDDEN");
		expect(body.error.details.message).toContain("Delete not allowed");
	});

	it("should call beforeDelete hook and abort if it returns a Response", async () => {
		const beforeDelete = vi.fn(async () => {
			return new Response(
				JSON.stringify({ error: { code: "HAS_CHILDREN", message: "Has deps" } }),
				{ status: 409 },
			);
		});
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Parent", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig({ beforeDelete }));

		const res = await handler(makeRequest("/api/admin/test-items/1", { method: "DELETE" }), env);

		expect(res.status).toBe(409);
		expect(beforeDelete).toHaveBeenCalledTimes(1);
	});

	it("should proceed when beforeDelete returns undefined", async () => {
		const beforeDelete = vi.fn(async () => undefined);
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "Item", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig({ beforeDelete }));

		const res = await handler(makeRequest("/api/admin/test-items/1", { method: "DELETE" }), env);

		expect(res.status).toBe(200);
		expect(beforeDelete).toHaveBeenCalledTimes(1);
	});

	it("should call afterDelete hook with correct args", async () => {
		const afterDelete = vi.fn(async () => {});
		const existing = { id: 1, name: "Gone", some_value: 99 };
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": existing,
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig({ afterDelete }));

		await handler(makeRequest("/api/admin/test-items/1", { method: "DELETE" }), env);

		expect(afterDelete).toHaveBeenCalledTimes(1);
		const [id, existingArg, envArg] = afterDelete.mock.calls[0];
		expect(id).toBe(1);
		expect(existingArg).toEqual(existing);
		expect(envArg).toBe(env);
	});

	it("should use default NOT_FOUND code when notFoundCode not set", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createRemoveHandler(makeTestConfig({ notFoundCode: undefined }));

		const res = await handler(makeRequest("/api/admin/test-items/999", { method: "DELETE" }), env);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe("NOT_FOUND");
	});
});

// ─── createBatchDeleteHandler ──────────────────────────────

describe("createBatchDeleteHandler", () => {
	it("should delete multiple items and return count", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "A", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, 2, 3] }),
			env,
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.deleted).toBe(true);
		expect(body.data.count).toBe(3); // all found because mock always returns for SELECT *
	});

	it("should return 400 for empty ids array", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [] }),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details.message).toContain("non-empty array");
	});

	it("should return 400 when ids is not an array", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: "not-array" }),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("should return 400 when ids is missing", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(makeJsonRequest("/api/admin/test-items/batch-delete", {}), env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("should return 400 when batch limit exceeded", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig({ batchLimit: 5 }));

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, 2, 3, 4, 5, 6] }),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("BATCH_LIMIT_EXCEEDED");
		expect(body.error.details.message).toContain("5");
	});

	it("should use default batchLimit of 100 when not configured", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "A", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig({ batchLimit: undefined }));

		// 6 items should be fine with default limit of 100
		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, 2, 3, 4, 5, 6] }),
			env,
		);

		expect(res.status).toBe(200);
	});

	it("should filter out non-numeric ids and return error if none remain", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: ["abc", "def", "xyz"] }),
			env,
		);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details.message).toContain("valid numbers");
	});

	it("should filter non-numeric ids but process valid ones", async () => {
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "A", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, "abc", 3] }),
			env,
		);
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.data.deleted).toBe(true);
		expect(body.data.count).toBe(2); // only numeric 1 and 3
	});

	it("should skip items not found in DB", async () => {
		let callCount = 0;
		const { db } = createMockDb({
			// Only first call returns a row, second returns null
		});
		// Override the mock to alternate results
		const originalPrepare = db.prepare as (sql: string) => ReturnType<D1Database["prepare"]>;
		db.prepare = vi.fn((sql: string) => {
			const stmt = originalPrepare(sql);
			if (sql.includes("SELECT * FROM test_items WHERE id")) {
				const originalBind = stmt.bind as (
					...params: unknown[]
				) => ReturnType<D1PreparedStatement["bind"]>;
				stmt.bind = vi.fn((...params: unknown[]) => {
					callCount++;
					const bound = originalBind(...params);
					bound.first = vi.fn(async () =>
						callCount === 1 ? { id: 1, name: "A", some_value: 0 } : null,
					);
					return bound;
				});
			}
			return stmt;
		}) as unknown as D1Database["prepare"];

		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, 2] }),
			env,
		);
		const body = await res.json();

		expect(body.data.count).toBe(1);
	});

	it("should skip items when beforeDelete hook returns a Response", async () => {
		let _hookCallCount = 0;
		const beforeDelete = vi.fn(async (id: number) => {
			_hookCallCount++;
			// Block deletion of id=2
			if (id === 2) {
				return new Response(JSON.stringify({ error: { code: "BLOCKED" } }), { status: 409 });
			}
			return undefined;
		});

		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "A", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig({ beforeDelete }));

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, 2, 3] }),
			env,
		);
		const body = await res.json();

		// id=2 is skipped, ids 1 and 3 are deleted
		expect(body.data.deleted).toBe(true);
		expect(body.data.count).toBe(2);
		expect(beforeDelete).toHaveBeenCalledTimes(3);
	});

	it("should call afterDelete for each successfully deleted item", async () => {
		const afterDelete = vi.fn(async () => {});
		const { db } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "A", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig({ afterDelete }));

		await handler(makeJsonRequest("/api/admin/test-items/batch-delete", { ids: [1, 2] }), env);

		expect(afterDelete).toHaveBeenCalledTimes(2);
	});

	it("should return 400 for invalid JSON body", async () => {
		const { db } = createMockDb();
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const req = new Request("https://api.example.com/api/admin/test-items/batch-delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not-json",
		});
		const res = await handler(req, env);

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("should convert string numeric ids to numbers", async () => {
		const { db, calls } = createMockDb({
			firstResults: {
				"SELECT * FROM test_items WHERE id": { id: 1, name: "A", some_value: 0 },
			},
		});
		const env = makeEnv({ DB: db });
		const handler = createBatchDeleteHandler(makeTestConfig());

		const res = await handler(
			makeJsonRequest("/api/admin/test-items/batch-delete", { ids: ["1", "2"] }),
			env,
		);

		expect(res.status).toBe(200);
		// Should have bound numeric values, not strings
		const deleteCalls = calls.filter((c) => c.sql.includes("DELETE"));
		for (const call of deleteCalls) {
			expect(typeof call.params[0]).toBe("number");
		}
	});
});
