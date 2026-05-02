import { describe, expect, it, vi } from "vitest";
import { getUserProfiles, invalidateUserCache } from "../../../src/lib/user-cache";
import { createMockCtx, makeEnv } from "../../helpers";

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

// D1 mock factory
function createMockD1(results: Record<string, unknown>[] = []) {
	return {
		prepare: vi.fn(() => ({
			bind: vi.fn(() => ({
				all: vi.fn(async () => ({ results })),
			})),
		})),
	} as unknown as D1Database;
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
			expect(db.prepare).not.toHaveBeenCalled();
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
			expect(db.prepare).toHaveBeenCalled();
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
