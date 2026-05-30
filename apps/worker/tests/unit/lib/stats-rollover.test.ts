import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkAndRolloverDailyStats } from "../../../src/lib/stats-rollover";

// ─── Helpers ──────────────────────────────────────────────────

function makeDb() {
	return {
		prepare: vi.fn(() => ({
			bind: vi.fn(() => ({
				run: vi.fn(async () => ({ success: true })),
			})),
		})),
	} as unknown as D1Database;
}

function makeKv(initialState: Record<string, string> = {}) {
	const store = { ...initialState };
	return {
		get: vi.fn(async (key: string) => store[key] ?? null),
		put: vi.fn(async (key: string, value: string) => {
			store[key] = value;
		}),
		delete: vi.fn(async (key: string) => {
			delete store[key];
		}),
		_store: store,
	} as unknown as KVNamespace & { _store: Record<string, string> };
}

function makeEnv(overrides: Partial<{ DB: D1Database; KV: KVNamespace }> = {}) {
	return {
		DB: overrides.DB ?? makeDb(),
		KV: overrides.KV ?? makeKv(),
	} as unknown as import("../../../src/lib/env").Env;
}

// ─── Tests ────────────────────────────────────────────────────

describe("stats-rollover", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("checkAndRolloverDailyStats", () => {
		it("initializes date marker on first run", async () => {
			// Set to 2026-05-30 10:00 Beijing time (02:00 UTC)
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			const kv = makeKv({});
			const env = makeEnv({ KV: kv });

			await checkAndRolloverDailyStats(env);

			// Should set today's date (no TTL)
			expect(kv.put).toHaveBeenCalledWith("stats:today_date", "2026-05-30");
		});

		it("does nothing when same day", async () => {
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			const db = makeDb();
			const kv = makeKv({
				"stats:today_date": "2026-05-30",
				"stats:today_posts": "5",
			});
			const env = makeEnv({ DB: db, KV: kv });

			await checkAndRolloverDailyStats(env);

			// Should NOT update settings
			expect(db.prepare).not.toHaveBeenCalled();
			// Should NOT reset today_posts
			expect(kv._store["stats:today_posts"]).toBe("5");
		});

		it("performs rollover when day changes", async () => {
			// Set to 2026-05-31 00:05 Beijing time (previous day was 2026-05-30)
			vi.setSystemTime(new Date("2026-05-30T16:05:00Z")); // 2026-05-31 00:05 Beijing

			const db = makeDb();
			const kv = makeKv({
				"stats:today_date": "2026-05-30",
				"stats:today_posts": "42",
			});
			const env = makeEnv({ DB: db, KV: kv });

			await checkAndRolloverDailyStats(env);

			// Should update settings.stats.yesterday_posts to 42
			expect(db.prepare).toHaveBeenCalledTimes(1);

			// Should reset today_posts to 0 (no TTL)
			expect(kv.put).toHaveBeenCalledWith("stats:today_posts", "0");

			// Should update today_date to new date (no TTL)
			expect(kv.put).toHaveBeenCalledWith("stats:today_date", "2026-05-31");
		});

		it("handles missing today_posts gracefully (defaults to 0)", async () => {
			vi.setSystemTime(new Date("2026-05-30T16:05:00Z")); // 2026-05-31 Beijing

			const db = makeDb();
			const kv = makeKv({
				"stats:today_date": "2026-05-30",
				// No today_posts key
			});
			const env = makeEnv({ DB: db, KV: kv });

			await checkAndRolloverDailyStats(env);

			// Should update settings with 0
			expect(db.prepare).toHaveBeenCalledTimes(1);
		});

		it("preserves orphaned today_posts when date marker is missing", async () => {
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			const db = makeDb();
			const kv = makeKv({
				// No today_date (marker missing)
				"stats:today_posts": "17", // But posts have accumulated
			});
			const env = makeEnv({ DB: db, KV: kv });

			await checkAndRolloverDailyStats(env);

			// Should move orphaned posts to yesterday
			expect(db.prepare).toHaveBeenCalledTimes(1);
			// Should reset today_posts
			expect(kv.put).toHaveBeenCalledWith("stats:today_posts", "0");
			// Should initialize date marker
			expect(kv.put).toHaveBeenCalledWith("stats:today_date", "2026-05-30");
			// Should invalidate public-stats cache
			expect(kv.delete).toHaveBeenCalledWith("public-stats");
		});

		it("just initializes marker when both marker and posts are missing", async () => {
			vi.setSystemTime(new Date("2026-05-30T02:00:00Z"));

			const db = makeDb();
			const kv = makeKv({
				// Empty state — first deploy
			});
			const env = makeEnv({ DB: db, KV: kv });

			await checkAndRolloverDailyStats(env);

			// Should NOT call DB (no posts to move)
			expect(db.prepare).not.toHaveBeenCalled();
			// Should only initialize date marker
			expect(kv.put).toHaveBeenCalledTimes(1);
			expect(kv.put).toHaveBeenCalledWith("stats:today_date", "2026-05-30");
		});
	});
});
