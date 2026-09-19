// apps/worker/tests/unit/lib/user-cache.test.ts

import { CACHE_SCHEMA_VERSION, getCacheTTL } from "@ellie/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getUserProfiles,
	invalidateUserCache,
	USER_CACHE_FAMILY,
	USER_CACHE_PREFIX,
	USER_CACHE_TIER,
	type UserMiniProfile,
} from "../../../src/lib/user-cache";
import { createMockCtx, makeEnv } from "../../helpers";

afterEach(() => {});

function makeValidMiniEnvelope(profile: UserMiniProfile) {
	const now = Date.now();
	return {
		schemaVersion: CACHE_SCHEMA_VERSION,
		family: USER_CACHE_FAMILY,
		tier: USER_CACHE_TIER,
		loadedAt: now,
		expiresAt: now + getCacheTTL(USER_CACHE_TIER) * 1000,
		params: { id: profile.id },
		scope: "public",
		data: profile,
	};
}

// Enhanced mock KV that supports both single get(key, "json") and bulk get(keys, "json")
function createJsonKV(initialData: Record<string, unknown> = {}) {
	const store = new Map<string, unknown>(Object.entries(initialData));
	return {
		get: vi.fn(async (keyOrKeys: string | string[], type?: string) => {
			if (Array.isArray(keyOrKeys)) {
				const map = new Map<string, unknown>();
				for (const k of keyOrKeys) {
					const raw = store.get(k);
					if (raw !== undefined && raw !== null) {
						map.set(k, structuredClone(raw));
					}
				}
				return map;
			}
			const raw = store.get(keyOrKeys);
			if (raw === undefined || raw === null) return null;
			if (type === "json") return structuredClone(raw);
			return JSON.stringify(raw);
		}),
		put: vi.fn(async (key: string, value: string) => {
			try {
				store.set(key, JSON.parse(value));
			} catch {
				store.set(key, value);
			}
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as KVNamespace;
}

function createMockD1(results: Record<string, unknown>[] = []) {
	const userQueries: string[] = [];
	const metricsQueries: string[] = [];
	const prepare = vi.fn((sql: string) => {
		const isMetrics = sql.includes("kv_cache_metrics_minute");
		if (isMetrics) metricsQueries.push(sql);
		else userQueries.push(sql);
		return {
			bind: vi.fn((...params: unknown[]) => ({
				all: vi.fn(async () => {
					if (isMetrics) return { success: true, results: [] };
					// Filter matching results by bound IDs if parameters provided
					if (params.length > 0) {
						const idSet = new Set(params);
						const filtered = results.filter((r) => idSet.has(r.id));
						return { success: true, results: filtered };
					}
					return { success: true, results };
				}),
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

		it("should return cached profiles from KV envelopes without DB call on cache hit", async () => {
			const alice: UserMiniProfile = {
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				avatarPath: "",
				role: 1,
				groupTitle: "Admin",
				groupColor: "#FF0000",
				groupStars: 9,
			};
			const bob: UserMiniProfile = {
				id: 2,
				username: "bob",
				avatar: "bob.png",
				avatarPath: "",
				role: 0,
				groupTitle: "User",
				groupColor: "#000",
				groupStars: 1,
			};

			const kv = createJsonKV({
				[`${USER_CACHE_PREFIX}1`]: makeValidMiniEnvelope(alice),
				[`${USER_CACHE_PREFIX}2`]: makeValidMiniEnvelope(bob),
			});

			const db = createMockD1();
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [1, 2]);

			expect(result.size).toBe(2);
			expect(result.get(1)?.username).toBe("alice");
			expect(result.get(2)?.username).toBe("bob");
			expect((db as unknown as { _userQueries: string[] })._userQueries).toEqual([]);
		});

		it("should fall back to DB for cache misses and backfill valid envelopes", async () => {
			const alice: UserMiniProfile = {
				id: 1,
				username: "alice",
				avatar: "avatar.png",
				avatarPath: "",
				role: 1,
				groupTitle: "Admin",
				groupColor: "#FF0000",
				groupStars: 9,
			};

			const kv = createJsonKV({
				[`${USER_CACHE_PREFIX}1`]: makeValidMiniEnvelope(alice),
			});

			const db = createMockD1([
				{
					id: 2,
					username: "bob",
					avatar: "bob.png",
					avatar_path: "/avatars/bob.png",
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
			expect(result.get(2)?.avatarPath).toBe("/avatars/bob.png");
			expect((db as unknown as { _userQueries: string[] })._userQueries.length).toBeGreaterThan(0);
		});

		it("should batch queries for missing entities when exceeding 80 IDs", async () => {
			const dbUsers = Array.from({ length: 150 }, (_, i) => ({
				id: i + 1,
				username: `user_${i + 1}`,
				avatar: "",
				avatar_path: null,
				role: 10,
				group_title: "Member",
				group_color: "",
				group_stars: 1,
			}));

			const kv = createJsonKV({});
			const db = createMockD1(dbUsers);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const requestedIds = dbUsers.map((u) => u.id);
			const result = await getUserProfiles(env, ctx, requestedIds);

			expect(result.size).toBe(150);
			// 150 items with batch size 80 must result in exactly 2 D1 user queries
			expect((db as unknown as { _userQueries: string[] })._userQueries.length).toBe(2);
		});

		it("should support undefined ctx and populate KV synchronously", async () => {
			const kv = createJsonKV();
			const db = createMockD1([
				{
					id: 5,
					username: "dave",
					avatar: "dave.png",
					avatar_path: null,
					role: 0,
					group_title: "Member",
					group_color: "",
					group_stars: 0,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });

			const result = await getUserProfiles(env, undefined, [5]);

			expect(result.size).toBe(1);
			expect(result.get(5)?.username).toBe("dave");
			expect(kv.put).toHaveBeenCalled();
		});

		it("should deduplicate user IDs and filter non-positive IDs", async () => {
			const kv = createJsonKV();
			const db = createMockD1([
				{
					id: 1,
					username: "alice",
					avatar: "",
					avatar_path: null,
					role: 0,
					group_title: "",
					group_color: "",
					group_stars: 0,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [1, 1, 0, -1, 1]);

			expect(result.size).toBe(1);
			expect(result.get(1)?.username).toBe("alice");
		});

		it("should reject expired envelopes and re-read from D1", async () => {
			const expiredEnvelope = {
				schemaVersion: CACHE_SCHEMA_VERSION,
				family: USER_CACHE_FAMILY,
				tier: USER_CACHE_TIER,
				loadedAt: Date.now() - 100_000,
				expiresAt: Date.now() - 100, // expired!
				params: { id: 10 },
				scope: "public",
				data: {
					id: 10,
					username: "stale_alice",
					avatar: "",
					avatarPath: "",
					role: 0,
					groupTitle: "",
					groupColor: "",
					groupStars: 0,
				},
			};

			const kv = createJsonKV({
				[`${USER_CACHE_PREFIX}10`]: expiredEnvelope,
			});

			const db = createMockD1([
				{
					id: 10,
					username: "fresh_alice",
					avatar: "",
					avatar_path: null,
					role: 0,
					group_title: "",
					group_color: "",
					group_stars: 0,
				},
			]);
			const env = makeEnv({ KV: kv, DB: db });
			const ctx = createMockCtx();

			const result = await getUserProfiles(env, ctx, [10]);

			expect(result.get(10)?.username).toBe("fresh_alice");
		});
	});

	describe("invalidateUserCache", () => {
		it("should delete the cache key from KV via cacheDelete", async () => {
			const kv = createJsonKV({
				[`${USER_CACHE_PREFIX}42`]: { data: "something" },
			});
			const env = makeEnv({ KV: kv });

			await invalidateUserCache(env, 42);

			expect(kv.delete).toHaveBeenCalledWith(`${USER_CACHE_PREFIX}42`);
		});

		it("should throw in strict mode when cacheDelete fails", async () => {
			const kv = {
				delete: vi.fn(async () => {
					throw new Error("KV delete failed");
				}),
			} as unknown as KVNamespace;
			const env = makeEnv({ KV: kv });

			await expect(invalidateUserCache(env, 42, { strict: true })).rejects.toThrow(
				"Failed to invalidate cache key user:mini:42",
			);
		});
	});
});
