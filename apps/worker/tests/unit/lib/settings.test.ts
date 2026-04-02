import { describe, expect, it, mock } from "bun:test";
import {
	type SettingsMap,
	getSetting,
	getSettings,
	getSettingsDetailed,
	upsertSettings,
} from "../../../src/lib/settings";
import { makeEnv } from "../../helpers";

// ─── Helpers ──────────────────────────────────────────────────

const SAMPLE_ROWS = [
	{ key: "general.site.name", value: "Ellie", type: "string", updated_at: 1700000000 },
	{ key: "general.pagination.posts_per_page", value: "20", type: "number", updated_at: 1700000000 },
	{ key: "general.og.title", value: "", type: "string", updated_at: 1700000000 },
	{
		key: "general.assets.avatar_cdn_base",
		value: "https://t.no.mt/avatar",
		type: "string",
		updated_at: 1700000000,
	},
];

const BOOLEAN_ROW = {
	key: "feature.enabled",
	value: "true",
	type: "boolean",
	updated_at: 1700000000,
};
const JSON_ROW = {
	key: "config.extra",
	value: '{"foo":"bar"}',
	type: "json",
	updated_at: 1700000000,
};
const BAD_NUMBER_ROW = { key: "bad.number", value: "abc", type: "number", updated_at: 1700000000 };
const BAD_JSON_ROW = { key: "bad.json", value: "not-json", type: "json", updated_at: 1700000000 };

function makeKvMock(cachedValue?: string) {
	return {
		get: mock(async () => cachedValue ?? null),
		put: mock(async () => {}),
		delete: mock(async () => {}),
	} as unknown as KVNamespace;
}

function makeDbMock(rows: Record<string, unknown>[] = SAMPLE_ROWS) {
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

// ─── Tests ────────────────────────────────────────────────────

describe("settings cache helper", () => {
	describe("getSettings", () => {
		it("should return parsed map from KV cache on hit", async () => {
			const cached: SettingsMap = {
				"general.site.name": "Ellie",
				"general.pagination.posts_per_page": 20,
			};
			const kv = makeKvMock(JSON.stringify(cached));
			const db = makeDbMock();
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			expect(result).toEqual(cached);
			expect(kv.get).toHaveBeenCalledWith("settings:all");
			// DB should NOT be called on cache hit
			expect(db.prepare).not.toHaveBeenCalled();
		});

		it("should read from D1 and backfill KV on cache miss", async () => {
			const kv = makeKvMock(); // no cached value
			const db = makeDbMock();
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			// Should parse types correctly
			expect(result["general.site.name"]).toBe("Ellie");
			expect(result["general.pagination.posts_per_page"]).toBe(20);
			expect(result["general.og.title"]).toBe("");
			expect(result["general.assets.avatar_cdn_base"]).toBe("https://t.no.mt/avatar");

			// Should have read from DB
			expect(db.prepare).toHaveBeenCalled();
			// Should backfill KV with TTL
			expect(kv.put).toHaveBeenCalledWith("settings:all", expect.any(String), {
				expirationTtl: 86400,
			});
		});

		it("should parse boolean type correctly", async () => {
			const kv = makeKvMock();
			const db = makeDbMock([BOOLEAN_ROW]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			expect(result["feature.enabled"]).toBe(true);
		});

		it("should parse json type correctly", async () => {
			const kv = makeKvMock();
			const db = makeDbMock([JSON_ROW]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			expect(result["config.extra"]).toEqual({ foo: "bar" });
		});

		it("should handle bad number value gracefully (returns 0)", async () => {
			const kv = makeKvMock();
			const db = makeDbMock([BAD_NUMBER_ROW]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			expect(result["bad.number"]).toBe(0);
		});

		it("should handle bad json value gracefully (returns {})", async () => {
			const kv = makeKvMock();
			const db = makeDbMock([BAD_JSON_ROW]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			expect(result["bad.json"]).toEqual({});
		});

		it("should handle empty results from D1", async () => {
			const kv = makeKvMock();
			const db = makeDbMock([]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettings(env);

			expect(result).toEqual({});
		});
	});

	describe("getSetting", () => {
		it("should return the correct value for an existing key", async () => {
			const cached: SettingsMap = {
				"general.site.name": "Ellie",
				"general.pagination.posts_per_page": 20,
			};
			const kv = makeKvMock(JSON.stringify(cached));
			const env = makeEnv({ KV: kv });

			const result = await getSetting(env, "general.site.name", "default");

			expect(result).toBe("Ellie");
		});

		it("should return default value for missing key", async () => {
			const cached: SettingsMap = { "general.site.name": "Ellie" };
			const kv = makeKvMock(JSON.stringify(cached));
			const env = makeEnv({ KV: kv });

			const result = await getSetting(env, "nonexistent.key", "fallback");

			expect(result).toBe("fallback");
		});

		it("should return default number value for missing key", async () => {
			const cached: SettingsMap = {};
			const kv = makeKvMock(JSON.stringify(cached));
			const env = makeEnv({ KV: kv });

			const result = await getSetting(env, "missing.number", 42);

			expect(result).toBe(42);
		});
	});

	describe("getSettingsDetailed", () => {
		it("should return full metadata from D1 (bypasses KV)", async () => {
			const kv = makeKvMock(JSON.stringify({ cached: true }));
			const db = makeDbMock();
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettingsDetailed(env);

			// Should always read from DB (admin needs fresh data)
			expect(db.prepare).toHaveBeenCalled();
			// Should include metadata
			expect(result["general.site.name"]).toEqual({
				value: "Ellie",
				type: "string",
				updatedAt: 1700000000,
			});
			expect(result["general.pagination.posts_per_page"]).toEqual({
				value: "20",
				type: "number",
				updatedAt: 1700000000,
			});
		});

		it("should handle empty DB results", async () => {
			const kv = makeKvMock();
			const db = makeDbMock([]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getSettingsDetailed(env);

			expect(result).toEqual({});
		});
	});

	describe("upsertSettings", () => {
		it("should batch update settings and invalidate KV", async () => {
			const kv = makeKvMock();
			const db = makeDbMock();
			const env = makeEnv({ KV: kv, DB: db });

			await upsertSettings(env, {
				"general.site.name": "New Name",
				"general.pagination.posts_per_page": "30",
			});

			// Should use batch for atomic update
			expect(db.batch).toHaveBeenCalledTimes(1);
			// Should invalidate KV cache
			expect(kv.delete).toHaveBeenCalledWith("settings:all");
		});

		it("should skip batch when entries is empty", async () => {
			const kv = makeKvMock();
			const db = makeDbMock();
			const env = makeEnv({ KV: kv, DB: db });

			await upsertSettings(env, {});

			expect(db.batch).not.toHaveBeenCalled();
			expect(kv.delete).not.toHaveBeenCalled();
		});

		it("should prepare UPDATE statements with correct bindings", async () => {
			const kv = makeKvMock();
			const preparedBindMock = mock((..._params: unknown[]) => ({
				run: mock(async () => ({ success: true })),
			}));
			const db = {
				prepare: mock(() => ({
					all: mock(async () => ({ results: [] })),
					bind: preparedBindMock,
				})),
				batch: mock(async (stmts: unknown[]) => stmts.map(() => ({ success: true, results: [] }))),
			} as unknown as D1Database;
			const env = makeEnv({ KV: kv, DB: db });

			await upsertSettings(env, { "general.site.name": "Updated" });

			// Should prepare UPDATE statement
			expect(db.prepare).toHaveBeenCalledWith(
				"UPDATE settings SET value = ?, updated_at = ? WHERE key = ?",
			);
			// Should bind value, timestamp, key
			expect(preparedBindMock).toHaveBeenCalledWith(
				"Updated",
				expect.any(Number),
				"general.site.name",
			);
		});
	});
});
