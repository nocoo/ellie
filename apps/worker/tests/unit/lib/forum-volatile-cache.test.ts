import { describe, expect, it, vi } from "vitest";
import {
	type ForumVolatileEntry,
	getForumVolatile,
	invalidateForumCacheAll,
	invalidateForumVolatile,
} from "../../../src/lib/forum-cache";
import { createMockCtx, makeEnv } from "../../helpers";

// ─── KV mock that supports "json" type parameter ────────────────────

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

// ─── D1 mock for volatile queries ──────────────────────────────────

function createMockD1ForVolatile(
	todayRows: { forum_id: number; cnt: number }[] = [],
	forumsRows: { id: number; threads: number; posts: number; last_thread_id: number }[] = [],
	lastThreadRows: {
		forum_id: number;
		thread_id: number;
		subject: string;
		last_post_at: number;
		last_poster_id: number;
		last_poster: string;
	}[] = [],
) {
	return {
		prepare: vi.fn((sql: string) => ({
			bind: vi.fn(() => ({
				all: vi.fn(async () => {
					if (sql.includes("COUNT(*)") && sql.includes("created_at")) {
						return { results: todayRows };
					}
					if (sql.includes("FROM threads t")) {
						return { results: lastThreadRows };
					}
					return { results: forumsRows };
				}),
			})),
			all: vi.fn(async () => {
				if (sql.includes("FROM forums")) {
					return { results: forumsRows };
				}
				return { results: todayRows };
			}),
		})),
	} as unknown as D1Database;
}

describe("forum-cache volatile", () => {
	describe("getForumVolatile", () => {
		it("returns cached volatile data from KV when enabled and hit", async () => {
			const entries: Record<number, ForumVolatileEntry> = {
				1: {
					lastThreadId: 100,
					lastThreadSubject: "Latest Thread",
					lastPostAt: 1700000000,
					lastPosterId: 5,
					lastPoster: "alice",
					todayThreads: 3,
					threads: 50,
					posts: 500,
				},
			};
			const kv = createJsonKV({
				"forums:volatile:v1": JSON.stringify({ entries, cachedAt: Date.now() }),
			});
			const db = createMockD1ForVolatile();
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [1]);

			expect(result[1]?.lastThreadSubject).toBe("Latest Thread");
			expect(result[1]?.todayThreads).toBe(3);
			// D1 should NOT be queried
			expect(db.prepare).not.toHaveBeenCalled();
		});

		it("falls through to D1 on KV miss and stores result", async () => {
			const kv = createJsonKV(); // empty KV
			const todayRows = [{ forum_id: 1, cnt: 2 }];
			const forumsRows = [{ id: 1, threads: 10, posts: 100, last_thread_id: 50 }];
			const lastThreadRows = [
				{
					forum_id: 1,
					thread_id: 50,
					subject: "Test",
					last_post_at: 1700000000,
					last_poster_id: 3,
					last_poster: "bob",
				},
			];
			const db = createMockD1ForVolatile(todayRows, forumsRows, lastThreadRows);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [1]);

			expect(result[1]?.todayThreads).toBe(2);
			expect(result[1]?.threads).toBe(10);
			expect(result[1]?.posts).toBe(100);
			expect(result[1]?.lastThreadId).toBe(50);
			expect(result[1]?.lastPoster).toBe("bob");
			// Should store in KV via waitUntil
			expect(ctx.waitUntil).toHaveBeenCalled();
		});

		it("falls through to D1 when cache is disabled", async () => {
			const kv = createJsonKV({
				"forums:volatile:v1": JSON.stringify({
					entries: { 1: { lastThreadId: 99 } },
					cachedAt: Date.now(),
				}),
			});
			const forumsRows = [{ id: 1, threads: 5, posts: 50, last_thread_id: 10 }];
			const db = createMockD1ForVolatile([], forumsRows, []);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "false" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [1]);

			// Should use D1 data, not cached data
			expect(result[1]?.threads).toBe(5);
			expect(kv.get).not.toHaveBeenCalled();
		});

		it("falls through to D1 when cached volatile payload is invalid", async () => {
			const kv = createJsonKV({
				"forums:volatile:v1": JSON.stringify({ entries: "not-an-object", cachedAt: Date.now() }),
			});
			const forumsRows = [{ id: 1, threads: 7, posts: 70, last_thread_id: 20 }];
			const db = createMockD1ForVolatile([], forumsRows, []);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [1]);

			expect(result[1]?.threads).toBe(7);
			expect(db.prepare).toHaveBeenCalled();
		});

		it("falls through to D1 when second entry is invalid but first is valid", async () => {
			const entries: Record<number, unknown> = {
				1: {
					lastThreadId: 100,
					lastThreadSubject: "Good Entry",
					lastPostAt: 1700000000,
					lastPosterId: 5,
					lastPoster: "alice",
					todayThreads: 3,
					threads: 50,
					posts: 500,
				},
				2: {
					// Missing required fields — stale schema
					lastThreadId: 200,
					threads: 10,
				},
			};
			const kv = createJsonKV({
				"forums:volatile:v1": JSON.stringify({ entries, cachedAt: Date.now() }),
			});
			const forumsRows = [
				{ id: 1, threads: 11, posts: 110, last_thread_id: 30 },
				{ id: 2, threads: 22, posts: 220, last_thread_id: 40 },
			];
			const db = createMockD1ForVolatile([], forumsRows, []);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [1, 2]);

			// Should fall through to D1, NOT use the cached (partially invalid) payload
			expect(result[1]?.threads).toBe(11);
			expect(result[2]?.threads).toBe(22);
			expect(db.prepare).toHaveBeenCalled();
		});

		it("falls through to D1 on KV read error", async () => {
			const kv = {
				get: vi.fn(async () => {
					throw new Error("KV read failure");
				}),
				put: vi.fn(async () => {}),
				delete: vi.fn(async () => {}),
			} as unknown as KVNamespace;
			const forumsRows = [{ id: 1, threads: 3, posts: 30, last_thread_id: 5 }];
			const db = createMockD1ForVolatile([], forumsRows, []);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [1]);

			expect(result[1]?.threads).toBe(3);
		});

		it("returns defaults for forums with no volatile data", async () => {
			const kv = createJsonKV();
			const db = createMockD1ForVolatile([], [], []);
			const env = makeEnv({ KV: kv, DB: db, USE_KV_FORUM_CACHE: "true" });
			const ctx = createMockCtx();

			const result = await getForumVolatile(env, ctx, [999]);

			expect(result[999]?.lastThreadId).toBe(0);
			expect(result[999]?.todayThreads).toBe(0);
			expect(result[999]?.threads).toBe(0);
			expect(result[999]?.posts).toBe(0);
			expect(result[999]?.lastPoster).toBe("");
		});
	});

	describe("invalidateForumVolatile", () => {
		it("deletes the volatile key from KV", async () => {
			const kv = createJsonKV({ "forums:volatile:v1": "data" });
			const env = makeEnv({ KV: kv });

			await invalidateForumVolatile(env);

			expect(kv.delete).toHaveBeenCalledWith("forums:volatile:v1");
		});

		it("does not throw on KV.delete failure", async () => {
			const kv = {
				get: vi.fn(),
				put: vi.fn(),
				delete: vi.fn(async () => {
					throw new Error("KV delete failure");
				}),
			} as unknown as KVNamespace;
			const env = makeEnv({ KV: kv });

			await expect(invalidateForumVolatile(env)).resolves.toBeUndefined();
		});
	});

	describe("invalidateForumCacheAll", () => {
		it("deletes both tree and volatile keys", async () => {
			const kv = createJsonKV({
				"forums:tree:v1": "tree-data",
				"forums:volatile:v1": "volatile-data",
			});
			const env = makeEnv({ KV: kv });

			await invalidateForumCacheAll(env);

			expect(kv.delete).toHaveBeenCalledWith("forums:tree:v1");
			expect(kv.delete).toHaveBeenCalledWith("forums:volatile:v1");
		});
	});
});
