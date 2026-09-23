import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicStats } from "../../../src/handlers/stats";
import { stats } from "../../../src/handlers/stats";
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

		it("should include meta with timestamp and requestId", async () => {
			const request = createRequest();
			const response = await stats(request, f.env, f.ctx);

			const body = (await response.json()) as { meta: { timestamp: number; requestId: string } };
			expect(body.meta.timestamp).toBeGreaterThan(0);
			expect(body.meta.requestId).toBeDefined();
			expect(typeof body.meta.requestId).toBe("string");
		});

		it("reads active members from D1 and performs no KV I/O", async () => {
			f.sqlite
				.prepare("UPDATE users SET last_activity=? WHERE id=10")
				.run(Math.floor(Date.now() / 1000));
			const response = await stats(createRequest(), f.env, f.ctx);
			expect(response.status).toBe(200);
			expect((await response.json()).data.totalOnline).toBe(1);
			expect(f.env.KV.get).not.toHaveBeenCalled();
			expect(f.env.KV.put).not.toHaveBeenCalled();
		});
	});
});
