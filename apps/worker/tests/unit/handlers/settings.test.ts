import { describe, expect, it, mock } from "bun:test";
import { list } from "../../../src/handlers/settings";
import { TEST_API_KEY, makeEnv } from "../../helpers";

// ─── Helpers ──────────────────────────────────────────────────

const SAMPLE_ROWS = [
	{ key: "general.site.name", value: "Ellie", type: "string", updated_at: 1700000000 },
	{ key: "general.pagination.posts_per_page", value: "20", type: "number", updated_at: 1700000000 },
	{ key: "general.og.title", value: "", type: "string", updated_at: 1700000000 },
	// Public features (access control and content toggles)
	{ key: "features.access.require_login", value: "true", type: "boolean", updated_at: 1700000000 },
	{ key: "features.access.maintenance_mode", value: "false", type: "boolean", updated_at: 1700000000 },
	{ key: "features.content.allow_new_thread", value: "true", type: "boolean", updated_at: 1700000000 },
	// Sensitive features (should NOT be exposed publicly)
	{ key: "features.registration.allow_new_user", value: "true", type: "boolean", updated_at: 1700000000 },
	{ key: "features.posting.min_registration_days", value: "7", type: "number", updated_at: 1700000000 },
];

function makeSettingsDb(rows = SAMPLE_ROWS) {
	return {
		prepare: mock(() => ({
			all: mock(async () => ({ results: rows })),
		})),
	} as unknown as D1Database;
}

function makeKv(cachedValue?: string) {
	return {
		get: mock(async () => cachedValue ?? null),
		put: mock(async () => {}),
		delete: mock(async () => {}),
	} as unknown as KVNamespace;
}

function createPublicRequest(method: string, path: string): Request {
	return new Request(`https://api.example.com${path}`, {
		method,
		headers: {
			"X-API-Key": TEST_API_KEY,
			"Content-Type": "application/json",
		},
	});
}

// ─── Tests ────────────────────────────────────────────────────

describe("public settings handler", () => {
	describe("#12b GET /api/v1/settings (list)", () => {
		it("should return typed settings map", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			// String value returned as-is
			expect(data["general.site.name"]).toBe("Ellie");
			// Number value parsed to number
			expect(data["general.pagination.posts_per_page"]).toBe(20);
			// Empty string
			expect(data["general.og.title"]).toBe("");
		});

		it("should use KV cache when available", async () => {
			const cached = JSON.stringify({
				"general.site.name": "Cached Ellie",
				"general.pagination.posts_per_page": 20,
			});
			const db = makeSettingsDb();
			const kv = makeKv(cached);
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(data["general.site.name"]).toBe("Cached Ellie");
			// DB should not be called when cache hits
			expect(db.prepare).not.toHaveBeenCalled();
		});

		it("should support ?prefix= filtering", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings?prefix=general.site");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(data["general.site.name"]).toBe("Ellie");
			expect(data["general.pagination.posts_per_page"]).toBeUndefined();
		});

		it("should return empty object for non-matching prefix", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings?prefix=nonexistent");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(Object.keys(data)).toHaveLength(0);
		});

		it("should expose features.access.* settings (public access control)", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings?prefix=features.access");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(data["features.access.require_login"]).toBe(true);
			expect(data["features.access.maintenance_mode"]).toBe(false);
		});

		it("should expose features.content.* settings (public content toggles)", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings?prefix=features.content");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			expect(data["features.content.allow_new_thread"]).toBe(true);
		});

		it("should NOT expose features.registration.* settings (sensitive)", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings?prefix=features.registration");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			// Should NOT contain registration settings
			expect(data["features.registration.allow_new_user"]).toBeUndefined();
			expect(Object.keys(data)).toHaveLength(0);
		});

		it("should NOT expose features.posting.* settings (sensitive)", async () => {
			const db = makeSettingsDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createPublicRequest("GET", "/api/v1/settings?prefix=features.posting");

			const response = await list(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as Record<string, unknown>;
			const data = body.data as Record<string, unknown>;

			// Should NOT contain posting threshold settings
			expect(data["features.posting.min_registration_days"]).toBeUndefined();
			expect(Object.keys(data)).toHaveLength(0);
		});
	});
});
