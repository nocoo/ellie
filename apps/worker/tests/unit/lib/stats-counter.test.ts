import { describe, expect, it, vi } from "vitest";
import {
	incrementStatsOnPostCreate,
	incrementStatsOnThreadCreate,
	incrementStatsOnUserRegister,
} from "../../../src/lib/stats-counter";

// ─── Helpers ──────────────────────────────────────────────────

function makeDb() {
	const bindCalls: unknown[][] = [];
	return {
		prepare: vi.fn(() => ({
			bind: vi.fn((...args: unknown[]) => {
				bindCalls.push(args);
				return {
					run: vi.fn(async () => ({ success: true })),
				};
			}),
		})),
		_bindCalls: bindCalls,
	} as unknown as D1Database & { _bindCalls: unknown[][] };
}

function makeKv() {
	let todayPosts = "0";
	return {
		get: vi.fn(async (key: string) => {
			if (key === "stats:today_posts") return todayPosts;
			return null;
		}),
		put: vi.fn(async (key: string, value: string) => {
			if (key === "stats:today_posts") todayPosts = value;
		}),
	} as unknown as KVNamespace;
}

function makeEnv(overrides: Partial<{ DB: D1Database; KV: KVNamespace }> = {}) {
	return {
		DB: overrides.DB ?? makeDb(),
		KV: overrides.KV ?? makeKv(),
	} as unknown as import("../../../src/lib/env").Env;
}

// ─── Tests ────────────────────────────────────────────────────

describe("stats-counter", () => {
	describe("incrementStatsOnThreadCreate", () => {
		it("increments total_threads, total_posts, and today_posts", async () => {
			const db = makeDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });

			await incrementStatsOnThreadCreate(env);

			// Should call prepare twice for settings counters
			expect(db.prepare).toHaveBeenCalledTimes(2);

			// Check that the right keys were bound
			const boundKeys = db._bindCalls.map((args) => args[1]);
			expect(boundKeys).toContain("stats.total_threads");
			expect(boundKeys).toContain("stats.total_posts");

			// Should increment KV today_posts (no TTL)
			expect(kv.put).toHaveBeenCalledWith("stats:today_posts", "1");
		});
	});

	describe("incrementStatsOnPostCreate", () => {
		it("increments total_posts and today_posts", async () => {
			const db = makeDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });

			await incrementStatsOnPostCreate(env);

			// Should call prepare once for stats.total_posts
			expect(db.prepare).toHaveBeenCalledTimes(1);
			const boundKey = db._bindCalls[0][1];
			expect(boundKey).toBe("stats.total_posts");

			// Should increment KV today_posts (no TTL)
			expect(kv.put).toHaveBeenCalledWith("stats:today_posts", "1");
		});

		it("increments existing today_posts value", async () => {
			const db = makeDb();
			const kv = {
				get: vi.fn(async () => "5"),
				put: vi.fn(async () => {}),
			} as unknown as KVNamespace;
			const env = makeEnv({ DB: db, KV: kv });

			await incrementStatsOnPostCreate(env);

			// Should increment to 6 (no TTL)
			expect(kv.put).toHaveBeenCalledWith("stats:today_posts", "6");
		});
	});

	describe("incrementStatsOnUserRegister", () => {
		it("increments total_members", async () => {
			const db = makeDb();
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });

			await incrementStatsOnUserRegister(env);

			// Should call prepare once for stats.total_members
			expect(db.prepare).toHaveBeenCalledTimes(1);
			const boundKey = db._bindCalls[0][1];
			expect(boundKey).toBe("stats.total_members");

			// Should NOT touch KV today_posts
			expect(kv.put).not.toHaveBeenCalled();
		});
	});
});
