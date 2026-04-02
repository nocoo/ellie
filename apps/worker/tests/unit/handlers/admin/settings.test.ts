import { describe, expect, it, mock } from "bun:test";
import { bulkUpdate, list } from "../../../../src/handlers/admin/settings";
import { createAdminRequest, makeEnv } from "../../../helpers";

// ─── Helpers ──────────────────────────────────────────────────

const SAMPLE_ROWS = [
	{ key: "general.site.name", value: "Ellie", type: "string", updated_at: 1700000000 },
	{ key: "general.site.subtitle", value: "Admin console", type: "string", updated_at: 1700000000 },
	{ key: "general.pagination.posts_per_page", value: "20", type: "number", updated_at: 1700000000 },
];

function makeSettingsDb(rows = SAMPLE_ROWS) {
	return {
		prepare: mock(() => ({
			all: mock(async () => ({ results: rows })),
			bind: mock((..._params: unknown[]) => ({
				run: mock(async () => ({ success: true })),
			})),
		})),
		batch: mock(async (stmts: unknown[]) => stmts.map(() => ({ success: true, results: [] }))),
	} as unknown as D1Database;
}

function makeKv() {
	return {
		get: mock(async () => null),
		put: mock(async () => {}),
		delete: mock(async () => {}),
	} as unknown as KVNamespace;
}

// ─── Tests ────────────────────────────────────────────────────

describe("admin settings handler", () => {
	describe("#62 GET /api/admin/settings (list)", () => {
		it("should return all settings with metadata", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("GET", "/api/admin/settings");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(data["general.site.name"]).toEqual({
				value: "Ellie",
				type: "string",
				updatedAt: 1700000000,
			});
			expect(data["general.pagination.posts_per_page"]).toEqual({
				value: "20",
				type: "number",
				updatedAt: 1700000000,
			});
		});

		it("should support ?prefix= filtering", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("GET", "/api/admin/settings?prefix=general.site");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(data["general.site.name"]).toBeDefined();
			expect(data["general.site.subtitle"]).toBeDefined();
			// pagination key should be filtered out
			expect(data["general.pagination.posts_per_page"]).toBeUndefined();
		});

		it("should return empty object for non-matching prefix", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("GET", "/api/admin/settings?prefix=nonexistent");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(Object.keys(data)).toHaveLength(0);
		});
	});

	describe("#63 PUT /api/admin/settings (bulkUpdate)", () => {
		it("should update valid settings and return count", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.site.name": "New Name",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.updated).toBe(1);

			// Should have used batch for atomic update
			expect(db.batch).toHaveBeenCalledTimes(1);
			// Should have invalidated KV
			expect(kv.delete).toHaveBeenCalledWith("settings:all");
		});

		it("should reject unknown keys with 400", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"unknown.key": "value",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("UNKNOWN_KEYS");
			expect(error.details).toEqual({ keys: ["unknown.key"] });
		});

		it("should reject non-positive number values with 400", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.pagination.page_size": "-5",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_NUMBER");
		});

		it("should reject zero for number keys", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.pagination.page_size": "0",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
		});

		it("should reject NaN for number keys", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.pagination.page_size": "abc",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_NUMBER");
		});

		it("should reject empty payload with 400", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("EMPTY_PAYLOAD");
		});

		it("should reject invalid JSON body", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = new Request("https://api.example.com/api/admin/settings", {
				method: "PUT",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: "not-json",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
		});

		it("should handle multiple valid keys in batch", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.site.name": "New Name",
				"general.site.subtitle": "New Subtitle",
				"general.pagination.page_size": "30",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;
			expect(data.updated).toBe(3);
		});

		it("should allow string keys with any value", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.site.name": "",
				"general.og.title": "Some OG title",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(200);
		});
	});
});
