import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetMetricsForTest } from "../../../src/lib/cache/metrics";
import { getUserProfiles, invalidateUserCache } from "../../../src/lib/user-cache";
import { createMockCtx, makeEnv } from "../../helpers";

afterEach(() => {
	__resetMetricsForTest();
});

// KV mock that supports the "json" type parameter
function createJsonKV(initialData: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initialData));
	return {
		get: vi.fn(async (key: string, type?: string) => {
			const raw = store.get(key) ?? null;
			if (raw === null) return null;
			if (type === "json") return JSON.parse(raw);
			return raw;
		}),
		put: vi.fn(async (key: string, value: string) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as KVNamespace;
}

// D1 mock factory. Distinguishes the user lookup statement from the
// (B.1) metrics UPSERT — `getUserProfiles` always schedules a metrics
// flush at the end, which goes through env.DB.prepare. Tests that
// previously asserted "no DB call when fully cached" now assert that
// no USER row was queried (the metrics row is fine and expected).
function createMockD1(results: Record<string, unknown>[] = []) {
	const userQueries: string[] = [];
	const metricsQueries: string[] = [];
	const prepare = vi.fn((sql: string) => {
		const isMetrics = sql.includes("kv_cache_metrics_minute");
		if (isMetrics) metricsQueries.push(sql);
		else userQueries.push(sql);
		return {
			bind: vi.fn(() => ({
				all: vi.fn(async () => ({ results: isMetrics ? [] : results })),
				run: vi.fn(async () => ({ success: true })),
			})),
		};
	});
	const db = { prepare } as unknown as D1Database & {
		_userQueries: string[];
		_metricsQueries: string[];
	};
	(db as unknown as { _userQueries: string[] })._userQueries = userQueries;
	(db as unknown as { _metricsQueries: string[] })._metricsQueries = metricsQueries;
	return db;
}

describe("user-cache", () => {
	describe("getUserProfiles", () => {
		it("should return empty map for empty userIds array", async () => {
			const kv = createJsonKV();
			const env = makeEnv({ KV: kv });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, []);

			expect(result.size).toBe(0);
		});

		it("should return empty map when all IDs are invalid (<=0)", async () => {
			const kv = createJsonKV();
			const env = makeEnv({ KV: kv });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [0, -1, -5]);

			expect(result.size).toBe(0);
		});

		it("should return cached profiles from KV without DB call", async () => {
			const kv = createJsonKV();
			await kv.put(
				"user:mini:1",
				JSON.stringify({
					id: 1,
					username: "alice",
					avatar: "avatar.png",
					role: 1,
					groupTitle: "Admin",
					groupColor: "#FF0000",
					groupStars: 9,
				}),
			);
			await kv.put(
				"user:mini:2",
				JSON.stringify({
					id: 2,
					username: "bob",
					avatar: "bob.png",
					role: 0,
					groupTitle: "User",
					groupColor: "#000",
					groupStars: 1,
				}),
			);

			const db = createMockD1();
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [1, 2]);

			expect(result.size).toBe(2);
			expect(result.get(1)?.username).toBe("alice");
			expect(result.get(2)?.username).toBe("bob");
			// No USER lookup hit D1 — both ids served from KV. The metrics
			// UPSERT may or may not be scheduled but does NOT count as a
			// user-side query.
			expect((db as unknown as { _userQueries: string[] })._userQueries).toEqual([]);
		});

		it("should fall back to DB for cache misses", async () => {
			const kv = createJsonKV();
			await kv.put(
				"user:mini:1",
				JSON.stringify({
					id: 1,
					username: "alice",
					avatar: "avatar.png",
					role: 1,
					groupTitle: "Admin",
					groupColor: "#FF0000",
					groupStars: 9,
				}),
			);

			const db = createMockD1([
				{
					id: 2,
					username: "bob",
					avatar: "bob.png",
					role: 0,
					group_title: "User",
					group_color: "#000",
					group_stars: 1,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [1, 2]);

			expect(result.size).toBe(2);
			expect(result.get(1)?.username).toBe("alice");
			expect(result.get(2)?.username).toBe("bob");
			// User-side D1 must have been queried for the cache miss.
			expect((db as unknown as { _userQueries: string[] })._userQueries.length).toBeGreaterThan(0);
		});

		it("should populate KV cache for DB results via waitUntil", async () => {
			const kv = createJsonKV();
			const db = createMockD1([
				{
					id: 3,
					username: "charlie",
					avatar: "charlie.png",
					role: 0,
					group_title: "Member",
					group_color: "#CCC",
					group_stars: 2,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [3]);

			expect(result.size).toBe(1);
			expect(result.get(3)?.username).toBe("charlie");
			expect(ctx._waitUntilPromises.length).toBeGreaterThan(0);

			// Await the background cache write and verify KV contents
			await Promise.all(ctx._waitUntilPromises);
			const cached = (await kv.get("user:mini:3", "json")) as Record<string, unknown>;
			expect(cached).not.toBeNull();
			expect(cached.username).toBe("charlie");
			expect(cached.avatar).toBe("charlie.png");
			expect(cached.role).toBe(0);
			expect(cached.groupTitle).toBe("Member");
		});

		it("should deduplicate user IDs", async () => {
			const kv = createJsonKV();
			const db = createMockD1([
				{
					id: 1,
					username: "alice",
					avatar: "",
					role: 0,
					group_title: "",
					group_color: "",
					group_stars: 0,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [1, 1, 1]);

			expect(result.size).toBe(1);
			expect(result.get(1)?.username).toBe("alice");
		});

		it("should filter invalid IDs from deduplicated set", async () => {
			const kv = createJsonKV();
			const db = createMockD1([
				{
					id: 1,
					username: "alice",
					avatar: "",
					role: 0,
					group_title: "",
					group_color: "",
					group_stars: 0,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [1, 0, -1]);

			expect(result.size).toBe(1);
			expect(result.get(1)?.username).toBe("alice");
		});
	});

	describe("invalidateUserCache", () => {
		it("should delete the cache key from KV", async () => {
			const kv = createJsonKV();
			await kv.put("user:mini:42", JSON.stringify({ id: 42 }));
			const env = makeEnv({ KV: kv });

			await invalidateUserCache(env, 42);

			const remaining = await kv.get("user:mini:42");
			expect(remaining).toBeNull();
		});
	});
});
