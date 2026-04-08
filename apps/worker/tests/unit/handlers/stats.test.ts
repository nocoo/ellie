import { describe, expect, it, mock } from "bun:test";
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

function makeStatsDb(counts: number[], newestUsername = "newbie") {
	const stmts = [
		// 0: todayPosts
		{ results: [{ cnt: counts[0] ?? 0 }] },
		// 1: yesterdayPosts
		{ results: [{ cnt: counts[1] ?? 0 }] },
		// 2: totalThreads
		{ results: [{ cnt: counts[2] ?? 0 }] },
		// 3: totalPosts
		{ results: [{ cnt: counts[3] ?? 0 }] },
		// 4: totalMembers
		{ results: [{ cnt: counts[4] ?? 0 }] },
		// 5: newestMember
		{ results: newestUsername ? [{ username: newestUsername }] : [] },
	];

	return {
		prepare: mock((_sql: string) => ({
			bind: mock(() => ({
				all: mock(async () => {
					// Not used by batch — included for completeness
					return { results: [] };
				}),
			})),
			all: mock(async () => ({ results: [] })),
		})),
		batch: mock(async () => stmts),
	} as unknown as D1Database;
}

function makeKv(options?: {
	cachedValue?: string;
	onlineCount?: string;
	peakData?: { count: number; date: string } | null;
}) {
	return {
		get: mock(async (key: string, type?: string) => {
			if (key === "public-stats") {
				return options?.cachedValue ?? null;
			}
			if (key === "stats:online_count") {
				return options?.onlineCount ?? null;
			}
			if (key === "stats:online_peak" && type === "json") {
				return options?.peakData ?? null;
			}
			return null;
		}),
		put: mock(async () => {}),
		delete: mock(async () => {}),
	} as unknown as KVNamespace;
}

// ─── Tests ────────────────────────────────────────────────────

describe("public stats handler", () => {
	describe("GET /api/v1/stats", () => {
		it("should return correct stats from DB when cache is empty", async () => {
			const db = makeStatsDb([5, 12, 3000, 9000000, 500], "latest_user");
			const kv = makeKv();
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
			expect(data.newestMember).toBe("latest_user");
			// Online stats return 0 (placeholder)
			expect(data.totalOnline).toBe(0);
			expect(data.peakOnline).toBe(0);
			expect(data.peakDate).toBe("");
		});

		it("should write result to KV cache after DB query", async () => {
			const db = makeStatsDb([1, 2, 100, 200, 50], "someone");
			const kv = makeKv();
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
			// TTL = 60 seconds
			expect((putCall[2] as { expirationTtl: number }).expirationTtl).toBe(60);
		});

		it("should return cached data without hitting DB", async () => {
			const cachedStats: PublicStats = {
				todayPosts: 99,
				yesterdayPosts: 88,
				totalThreads: 7777,
				totalPosts: 5555,
				totalMembers: 1234,
				newestMember: "cached_user",
				totalOnline: 0,
				peakOnline: 0,
				peakDate: "",
			};
			const db = makeStatsDb([0, 0, 0, 0, 0]);
			const kv = makeKv({ cachedValue: JSON.stringify(cachedStats) });
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };

			expect(body.data.todayPosts).toBe(99);
			expect(body.data.newestMember).toBe("cached_user");
			// DB batch should NOT have been called
			expect(db.batch).not.toHaveBeenCalled();
		});

		it("should handle empty users table gracefully", async () => {
			const stmts = [
				{ results: [{ cnt: 0 }] }, // todayPosts
				{ results: [{ cnt: 0 }] }, // yesterdayPosts
				{ results: [{ cnt: 0 }] }, // totalThreads
				{ results: [{ cnt: 0 }] }, // totalPosts
				{ results: [{ cnt: 0 }] }, // totalMembers
				{ results: [] }, // newestMember - no users
			];
			const db = {
				prepare: mock(() => ({
					bind: mock(() => ({})),
				})),
				batch: mock(async () => stmts),
			} as unknown as D1Database;
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data.newestMember).toBe("");
			expect(body.data.totalMembers).toBe(0);
		});

		it("should include meta with timestamp and requestId", async () => {
			const db = makeStatsDb([0, 0, 0, 0, 0]);
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			const response = await stats(request, env);

			const body = (await response.json()) as { meta: { timestamp: number; requestId: string } };
			expect(body.meta.timestamp).toBeGreaterThan(0);
			expect(body.meta.requestId).toBeDefined();
			expect(typeof body.meta.requestId).toBe("string");
		});

		it("should use batch query for efficiency (single DB roundtrip)", async () => {
			const db = makeStatsDb([1, 2, 3, 4, 5]);
			const kv = makeKv();
			const env = makeEnv({ DB: db, KV: kv });
			const request = createRequest();

			await stats(request, env);

			// Should use batch (1 call) instead of individual queries
			expect(db.batch).toHaveBeenCalledTimes(1);
		});

		it("should return online stats from KV", async () => {
			const db = makeStatsDb([0, 0, 0, 0, 0]);
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
			const db = makeStatsDb([0, 0, 0, 0, 0]);
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
	});
});
