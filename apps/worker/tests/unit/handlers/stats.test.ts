import { describe, expect, it, type mock, vi } from "vitest";
import { stats } from "../../../src/handlers/stats";
import type { PublicStats } from "../../../src/handlers/stats";
import { TEST_API_KEY, makeEnv } from "../../helpers";

// ─── Helpers ──────────────────────────────────────────────────

function createRequest(path = "/api/v1/stats"): Request {
	return new Request(`https://api.example.com${path}`, {
		method: "GET",
		headers: {
			"X-API-Key": TEST_API_KEY,
			"Content-Type": "application/json",
		},
	});
}

/**
 * Create a mock DB that returns settings rows for stats counters.
 */
function makeStatsDb(counters: {
	totalThreads?: number;
	totalPosts?: number;
	totalMembers?: number;
	yesterdayPosts?: number;
}) {
	const settingsRows = [
		{ key: "stats.total_threads", value: String(counters.totalThreads ?? 0) },
		{ key: "stats.total_posts", value: String(counters.totalPosts ?? 0) },
		{ key: "stats.total_members", value: String(counters.totalMembers ?? 0) },
		{ key: "stats.yesterday_posts", value: String(counters.yesterdayPosts ?? 0) },
	];

	return {
		prepare: vi.fn((_sql: string) => ({
			bind: vi.fn(() => ({
				all: vi.fn(async () => ({ results: settingsRows })),
			})),
			all: vi.fn(async () => ({ results: settingsRows })),
		})),
		batch: vi.fn(async () => []),
	} as unknown as D1Database;
}

function makeKv(options?: {
	cachedValue?: string;
	todayPosts?: string;
	onlineCount?: string;
	peakData?: { count: number; date: string } | null;
}) {
	return {
		get: vi.fn(async (key: string, type?: string) => {
			if (key === "public-stats") {
				return options?.cachedValue ?? null;
			}
			if (key === "stats:today_posts") {
				return options?.todayPosts ?? null;
			}
			if (key === "stats:online_count") {
				return options?.onlineCount ?? null;
			}
			if (key === "stats:online_peak" && type === "json") {
				return options?.peakData ?? null;
			}
			return null;
		}),
		put: vi.fn(async () => {}),
		delete: vi.fn(async () => {}),
	} as unknown as KVNamespace;
}

// ─── Tests ────────────────────────────────────────────────────

describe("public stats handler", () => {
	describe("GET /api/v1/stats", () => {
		it("should return correct stats from settings and KV when cache is empty", async () => {
			const db = makeStatsDb({
				totalThreads: 3000,
				totalPosts: 9000000,
				totalMembers: 500,
				yesterdayPosts: 12,
			});
			const kv = makeKv({ todayPosts: "5" });
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			const data = body.data;

			expect(data.todayPosts).toBe(5);
			expect(data.yesterdayPosts).toBe(12);
			expect(data.totalThreads).toBe(3000);
			expect(data.totalPosts).toBe(9000000);
			expect(data.totalMembers).toBe(500);
			// Online stats return 0 (placeholder)
			expect(data.totalOnline).toBe(0);
			expect(data.peakOnline).toBe(0);
			expect(data.peakDate).toBe("");
		});

		it("should write result to KV cache after reading settings", async () => {
			const db = makeStatsDb({
				totalThreads: 100,
				totalPosts: 200,
				totalMembers: 50,
				yesterdayPosts: 2,
			});
			const kv = makeKv({ todayPosts: "1" });
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			await stats(request, env);

			expect(kv.put).toHaveBeenCalledTimes(1);
			// Verify cache key and TTL
			const putCall = (kv.put as ReturnType<typeof mock>).mock.calls[0];
			expect(putCall[0]).toBe("public-stats");
			const cached = JSON.parse(putCall[1] as string) as PublicStats;
			expect(cached.todayPosts).toBe(1);
			expect(cached.totalMembers).toBe(50);
			// TTL = 600 seconds
			expect((putCall[2] as { expirationTtl: number }).expirationTtl).toBe(600);
		});

		it("should return cached data without hitting DB", async () => {
			const cachedStats: PublicStats = {
				todayPosts: 99,
				yesterdayPosts: 88,
				totalThreads: 7777,
				totalPosts: 5555,
				totalMembers: 1234,
				totalOnline: 0,
				peakOnline: 0,
				peakDate: "",
			};
			const db = makeStatsDb({});
			const kv = makeKv({ cachedValue: JSON.stringify(cachedStats) });
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };

			expect(body.data.todayPosts).toBe(99);
			expect(body.data.totalMembers).toBe(1234);
			// DB prepare should NOT have been called (cache hit)
			expect(db.prepare).not.toHaveBeenCalled();
		});

		it("should handle missing settings gracefully (return 0)", async () => {
			// DB returns empty results
			const db = {
				prepare: vi.fn(() => ({
					bind: vi.fn(() => ({
						all: vi.fn(async () => ({ results: [] })),
					})),
				})),
			} as unknown as D1Database;
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data.totalMembers).toBe(0);
			expect(body.data.totalPosts).toBe(0);
			expect(body.data.totalThreads).toBe(0);
			expect(body.data.yesterdayPosts).toBe(0);
			expect(body.data.todayPosts).toBe(0);
		});

		it("should include meta with timestamp and requestId", async () => {
			const db = makeStatsDb({});
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			const body = (await response.json()) as { meta: { timestamp: number; requestId: string } };
			expect(body.meta.timestamp).toBeGreaterThan(0);
			expect(body.meta.requestId).toBeDefined();
			expect(typeof body.meta.requestId).toBe("string");
		});

		it("should read settings with single query (no batch needed)", async () => {
			const db = makeStatsDb({ totalThreads: 100 });
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			await stats(request, env);

			// Should use prepare (for settings query)
			expect(db.prepare).toHaveBeenCalledTimes(1);
			// Should NOT use batch (old implementation)
			expect(db.batch).not.toHaveBeenCalled();
		});

		it("should return online stats from KV", async () => {
			const db = makeStatsDb({});
			const kv = makeKv({
				onlineCount: "42",
				peakData: { count: 100, date: "2024-03-31" },
			});
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data.totalOnline).toBe(42);
			expect(body.data.peakOnline).toBe(100);
			expect(body.data.peakDate).toBe("2024-03-31");
		});

		it("should return 0 for online stats when KV has no data", async () => {
			const db = makeStatsDb({});
			const kv = makeKv({ onlineCount: undefined, peakData: null });
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data.totalOnline).toBe(0);
			expect(body.data.peakOnline).toBe(0);
			expect(body.data.peakDate).toBe("");
		});

		it("should return 0 for todayPosts when KV key is missing", async () => {
			const db = makeStatsDb({ totalThreads: 100 });
			const kv = makeKv({ todayPosts: undefined });
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data.todayPosts).toBe(0);
		});
	});
});
