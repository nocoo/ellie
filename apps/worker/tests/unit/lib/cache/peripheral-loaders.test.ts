import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	peripheralCacheKey,
	rebuildPeripheralCache,
} from "../../../../src/lib/cache/peripheral-loaders";
import { readingFixture } from "./thread-cache-fixture";

describe("lib/cache/peripheral-loaders", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		f = readingFixture();
	});

	afterEach(() => {
		f.close();
		vi.restoreAllMocks();
	});

	describe("peripheralCacheKey descriptor validation", () => {
		it("rejects non-public scope", async () => {
			await expect(
				peripheralCacheKey(f.env, {
					family: "settings:all",
					params: {},
					scope: "internal",
				}),
			).rejects.toThrow("Invalid peripheral cache scope");
		});

		it("rejects unknown family or unexpected params", async () => {
			await expect(
				peripheralCacheKey(f.env, {
					family: "unknown:family",
					params: {},
					scope: "public",
				}),
			).rejects.toThrow("Invalid peripheral cache descriptor");

			await expect(
				peripheralCacheKey(f.env, {
					family: "settings:all",
					params: { extra: 1 },
					scope: "public",
				}),
			).rejects.toThrow("Invalid peripheral cache descriptor");
		});

		it("validates user:mini:v1 params strictly", async () => {
			await expect(
				peripheralCacheKey(f.env, {
					family: "user:mini:v1",
					params: {},
					scope: "public",
				}),
			).rejects.toThrow("Invalid mini profile descriptor");

			await expect(
				peripheralCacheKey(f.env, {
					family: "user:mini:v1",
					params: { id: -1 },
					scope: "public",
				}),
			).rejects.toThrow("Invalid mini profile descriptor");

			await expect(
				peripheralCacheKey(f.env, {
					family: "user:mini:v1",
					params: { id: 0 },
					scope: "public",
				}),
			).rejects.toThrow("Invalid mini profile descriptor");

			const key = await peripheralCacheKey(f.env, {
				family: "user:mini:v1",
				params: { id: 42 },
				scope: "public",
			});
			expect(key).toBe("user:mini:42");
		});

		it("does not query D1 during key generation", async () => {
			const callsBefore = f.calls.length;
			const key1 = await peripheralCacheKey(f.env, {
				family: "settings:all",
				params: {},
				scope: "public",
			});
			const key2 = await peripheralCacheKey(f.env, {
				family: "public-stats",
				params: {},
				scope: "public",
			});
			const key3 = await peripheralCacheKey(f.env, {
				family: "user:mini:v1",
				params: { id: 10 },
				scope: "public",
			});

			expect(key1).toBe("settings:all");
			expect(key2).toBe("public-stats");
			expect(key3).toBe("user:mini:10");
			expect(f.calls.length).toBe(callsBefore);
		});
	});

	describe("rebuildPeripheralCache loaders", () => {
		it("rebuilds settings:all from D1 settings table", async () => {
			f.sqlite
				.prepare(
					"INSERT INTO settings (key, value, type, updated_at) VALUES ('site.name', 'Ellie Forum', 'string', 0)",
				)
				.run();
			const result = (await rebuildPeripheralCache(f.env, f.ctx, {
				family: "settings:all",
				params: {},
				scope: "public",
			})) as Record<string, unknown>;

			expect(result).toBeDefined();
			expect(result["site.name"]).toBe("Ellie Forum");
		});

		it("rebuilds public-stats from settings and posts", async () => {
			const result = (await rebuildPeripheralCache(f.env, f.ctx, {
				family: "public-stats",
				params: {},
				scope: "public",
			})) as Record<string, unknown>;

			expect(result).toBeDefined();
			expect(result).toHaveProperty("todayPosts");
			expect(result).toHaveProperty("totalPosts");
			expect(result).toHaveProperty("totalThreads");
			expect(result).toHaveProperty("totalMembers");
		});

		it("rebuilds user:mini:v1 for existing and missing users", async () => {
			// user 10 (alice) exists in fixture
			const alice = (await rebuildPeripheralCache(f.env, f.ctx, {
				family: "user:mini:v1",
				params: { id: 10 },
				scope: "public",
			})) as { id: number; username: string };

			expect(alice).not.toBeNull();
			expect(alice.id).toBe(10);
			expect(alice.username).toBe("alice");

			// missing user returns null
			const missing = await rebuildPeripheralCache(f.env, f.ctx, {
				family: "user:mini:v1",
				params: { id: 99999 },
				scope: "public",
			});
			expect(missing).toBeNull();
		});

		it("D1 failure throws error and is not faked", async () => {
			f.state.queryError = true;
			await expect(
				rebuildPeripheralCache(f.env, f.ctx, {
					family: "settings:all",
					params: {},
					scope: "public",
				}),
			).rejects.toThrow();
		});
	});
});
