import { describe, expect, it, vi } from "vitest";
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
		prepare: vi.fn(() => ({
			all: vi.fn(async () => ({ results: rows })),
			bind: vi.fn((..._params: unknown[]) => ({
				run: vi.fn(async () => ({ success: true })),
			})),
		})),
		batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ success: true, results: [] }))),
	} as unknown as D1Database;
}

function makeKv() {
	return {
		get: vi.fn(async () => null),
		put: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
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

		it("should reject invalid boolean value", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"features.access.maintenance_mode": "yes",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_BOOLEAN");
		});

		it("should accept valid boolean value", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"features.access.maintenance_mode": "true",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(200);
		});

		it("should reject invalid JSON navigation links", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.navigation.header_links": "not-json",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_JSON_VALUE");
		});

		it("should reject JSON array with wrong structure", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.navigation.header_links": JSON.stringify([{ wrong: "structure" }]),
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
		});

		it("should reject non-array JSON value for navigation links", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.navigation.header_links": JSON.stringify({ label: "a", url: "b" }),
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
		});

		it("should accept valid JSON navigation links", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"general.navigation.header_links": JSON.stringify([
					{ label: "Home", url: "/" },
					{ label: "About", url: "/about" },
				]),
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(200);
		});

		it("should validate non-negative number keys (allow zero)", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"features.posting.min_registration_days": "0",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(200);
		});

		it("should reject negative values for non-negative number keys", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"features.posting.min_registration_days": "-1",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
		});

		it("should reject non-integer values for non-negative number keys", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createAdminRequest("PUT", "/api/admin/settings", {
				"features.posting.min_registration_days": "3.5",
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
		});

		it("should reject non-object body", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = new Request("https://api.example.com/api/admin/settings", {
				method: "PUT",
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
				},
				body: JSON.stringify([1, 2, 3]),
			});

			const response = await bulkUpdate(request, env);

			expect(response.status).toBe(400);
			const body = (await response.json()) as Record<string, unknown>;
			const error = body.error as Record<string, unknown>;
			expect(error.code).toBe("INVALID_BODY");
		});
	});

	// ─── F3-c: audit instrumentation ─────────────────────────────────

	describe("F3-c audit instrumentation", () => {
		// settings tests use a custom slim mock; for audit we need a richer mock
		// that exposes per-prepare SQL/params (so we can find the admin_logs INSERT).

		function makeAuditingDb(priorRows: typeof SAMPLE_ROWS) {
			const calls: { sql: string; params: unknown[] }[] = [];
			const db = {
				prepare: vi.fn((sql: string) => ({
					all: vi.fn(async () => ({ results: priorRows })),
					bind: vi.fn((...params: unknown[]) => {
						calls.push({ sql, params });
						return {
							run: vi.fn(async () => ({ success: true })),
							first: vi.fn(async () => null),
							all: vi.fn(async () => ({ results: [] })),
						};
					}),
				})),
				batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ success: true, results: [] }))),
			} as unknown as D1Database;
			return { db, calls };
		}

		function findAuditInsert(calls: { sql: string; params: unknown[] }[]) {
			return calls.find((c) => c.sql.includes("INSERT INTO admin_logs"));
		}

		function actorReq(method: string, path: string, body?: unknown): Request {
			return new Request(`https://api.example.com${path}`, {
				method,
				headers: {
					"X-API-Key": "test-admin-api-key",
					"Content-Type": "application/json",
					"X-Admin-Actor-Email": "alice@example.com",
					"X-Admin-Actor-Name": "Alice",
				},
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		}

		it("PUT writes setting.update with changedKeys + before/after for non-sensitive keys", async () => {
			const { db, calls } = makeAuditingDb(SAMPLE_ROWS);
			const env = makeEnv({ DB: db, KV: makeKv() });
			const res = await bulkUpdate(
				actorReq("PUT", "/api/admin/settings", { "general.site.name": "Renamed" }),
				env,
			);
			expect(res.status).toBe(200);
			const insert = findAuditInsert(calls);
			expect(insert).toBeTruthy();
			expect(insert?.params[2]).toBe("setting.update");
			expect(insert?.params[3]).toBe("setting");
			expect(insert?.params[4]).toBeNull();
			const details = JSON.parse(insert?.params[5] as string);
			expect(details.changedKeys).toEqual(["general.site.name"]);
			expect(details.before["general.site.name"]).toBe("Ellie");
			expect(details.after["general.site.name"]).toBe("Renamed");
		});

		it("PUT no-op (same value) does NOT write audit row", async () => {
			const { db, calls } = makeAuditingDb(SAMPLE_ROWS);
			const env = makeEnv({ DB: db, KV: makeKv() });
			const res = await bulkUpdate(
				actorReq("PUT", "/api/admin/settings", { "general.site.name": "Ellie" }),
				env,
			);
			expect(res.status).toBe(200);
			expect(findAuditInsert(calls)).toBeUndefined();
		});

		// Note: sensitive-key redaction (password/secret/token/auth/etc. substrings)
		// is defense-in-depth for future ALLOWED_KEYS additions. None of the
		// currently whitelisted keys contain any sensitive substring, so it
		// cannot be exercised end-to-end through bulkUpdate without expanding
		// the whitelist. The classifier's unit-level coverage lives alongside
		// the handler if/when a sensitive key is added to ALLOWED_KEYS.
	});
});
