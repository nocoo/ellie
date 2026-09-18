import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStats } from "../../../src/handlers/stats";
import { stats } from "../../../src/handlers/stats";
import { __resetMetricsForTest } from "../../../src/lib/cache/metrics";
import { shanghaiTodayStartUnix } from "../../../src/lib/shanghaiTime";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

function createRequest(path = "/api/v1/stats"): Request {
	return new Request(`https://api.example.com${path}`, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
		},
	});
}

describe("public stats handler", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-30T10:00:00Z"));
		__resetMetricsForTest();
		f = readingFixture();
		f.thread(1);
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("GET /api/v1/stats", () => {
		it("should return correct stats from settings and posts count when cache is empty", async () => {
			f.sqlite
				.prepare("UPDATE settings SET value = '3000' WHERE key = 'stats.total_threads'")
				.run();
			f.sqlite
				.prepare("UPDATE settings SET value = '9000000' WHERE key = 'stats.total_posts'")
				.run();
			f.sqlite.prepare("UPDATE settings SET value = '500' WHERE key = 'stats.total_members'").run();
			f.sqlite
				.prepare("UPDATE settings SET value = '12' WHERE key = 'stats.yesterday_posts'")
				.run();

			const todayStart = shanghaiTodayStartUnix();
			for (let i = 0; i < 5; i++) {
				f.post(100 + i, { created_at: todayStart + i * 10 });
			}

			const request = createRequest();
			const response = await stats(request, f.env, f.ctx);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			const data = body.data;

			expect(data.todayPosts).toBe(5);
			expect(data.yesterdayPosts).toBe(12);
			expect(data.totalThreads).toBe(3000);
			expect(data.totalPosts).toBe(9000000);
			expect(data.totalMembers).toBe(500);
			expect(data.totalOnline).toBe(0);
			expect(data.peakOnline).toBe(0);
			expect(data.peakDate).toBe("");
		});

		it("should write result to KV cache with SHORT tier and fixed 60s expiry", async () => {
			f.sqlite.prepare("UPDATE settings SET value = '100' WHERE key = 'stats.total_threads'").run();
			f.sqlite.prepare("UPDATE settings SET value = '200' WHERE key = 'stats.total_posts'").run();
			f.sqlite.prepare("UPDATE settings SET value = '50' WHERE key = 'stats.total_members'").run();
			f.sqlite.prepare("UPDATE settings SET value = '2' WHERE key = 'stats.yesterday_posts'").run();

			const todayStart = shanghaiTodayStartUnix();
			f.post(200, { created_at: todayStart + 10 });

			const request = createRequest();
			await stats(request, f.env, f.ctx);

			expect(f.env.KV.put).toHaveBeenCalledTimes(1);
			const putCall = (f.env.KV.put as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
			expect(putCall[0]).toBe("public-stats");

			const rawEnvelope = putCall[1] as string;
			const envelope = JSON.parse(rawEnvelope);
			expect(envelope.tier).toBe("SHORT");
			expect(envelope.family).toBe("public-stats");
			expect(envelope.data.todayPosts).toBe(1);
			expect(envelope.data.totalMembers).toBe(50);
			// Fixed SHORT TTL = 60 seconds
			expect(putCall[2]).toMatchObject({ expirationTtl: 60 });
		});

		it("should return cached data without hitting DB", async () => {
			const todayStart = shanghaiTodayStartUnix();
			f.post(300, { created_at: todayStart + 10 });

			const request = createRequest();
			const res1 = await stats(request, f.env, f.ctx);
			expect(res1.status).toBe(200);

			const callsBefore = f.calls.length;
			const res2 = await stats(request, f.env, f.ctx);
			expect(res2.status).toBe(200);

			// Cache hit: no extra DB calls
			expect(f.calls.length).toBe(callsBefore);
		});

		it("should include meta with timestamp and requestId", async () => {
			const request = createRequest();
			const response = await stats(request, f.env, f.ctx);

			const body = (await response.json()) as { meta: { timestamp: number; requestId: string } };
			expect(body.meta.timestamp).toBeGreaterThan(0);
			expect(body.meta.requestId).toBeDefined();
			expect(typeof body.meta.requestId).toBe("string");
		});

		it("should return online stats from KV", async () => {
			await f.env.KV.put("stats:online_count", "42");
			await f.env.KV.put("stats:online_peak", JSON.stringify({ count: 100, date: "2026-05-29" }));

			const request = createRequest();
			const response = await stats(request, f.env, f.ctx);

			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data.totalOnline).toBe(42);
			expect(body.data.peakOnline).toBe(0);
			expect(body.data.peakDate).toBe("");
		});

		it("should handle cache envelope read failure gracefully and fall back to fresh load", async () => {
			// Preload cache
			await stats(createRequest(), f.env, f.ctx);

			// Corrupt KV cache entry for "public-stats"
			f.values.set("public-stats", "{not-valid-json");

			const response = await stats(createRequest(), f.env, f.ctx);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data).toBeDefined();
		});

		it("should handle KV write failure gracefully without breaking response", async () => {
			f.state.writeError = true;

			const response = await stats(createRequest(), f.env, f.ctx);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { data: PublicStats };
			expect(body.data).toBeDefined();
		});
	});
});
