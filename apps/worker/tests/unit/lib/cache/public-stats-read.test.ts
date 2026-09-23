import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	countPostsInDay,
	countRecentlyActiveUsers,
	loadPublicStats,
} from "../../../../src/lib/cache/public-stats-read";
import { shanghaiTodayStartUnix } from "../../../../src/lib/shanghaiTime";
import { readingFixture } from "./thread-cache-fixture";

describe("authoritative public statistics", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-05-30T10:00:00Z"));
		f = readingFixture();
		f.thread(1);
	});
	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});
	it("counts only the Shanghai calendar day using indexed bounds", async () => {
		const start = shanghaiTodayStartUnix();
		for (const [i, offset] of [-1, 0, 3600, 86399, 86400].entries())
			f.post(i + 100, { created_at: start + offset });
		expect(await countPostsInDay(f.env)).toBe(3);
		expect(f.calls.at(-1)?.params).toEqual([start, start + 86400]);
	});
	it("counts active members inclusively at thirty minutes without consulting KV", async () => {
		const now = Math.floor(Date.now() / 1000);
		f.sqlite.prepare("UPDATE users SET last_activity=? WHERE id=10").run(now - 1800);
		f.sqlite.prepare("UPDATE users SET last_activity=? WHERE id=20").run(now - 1801);
		f.sqlite.prepare("UPDATE users SET last_activity=?, status=1 WHERE id=30").run(now);
		expect(await countRecentlyActiveUsers(f.env)).toBe(1);
		expect(f.calls.at(-1)?.sql).toContain("INDEXED BY idx_users_active_last_activity");
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});
	it("reloads persisted counters and committed posts without KV reads or writes", async () => {
		f.sqlite.exec("UPDATE settings SET value='120' WHERE key='stats.total_threads'");
		f.post(201, { created_at: shanghaiTodayStartUnix() });
		expect(await loadPublicStats(f.env)).toMatchObject({ totalThreads: 120, todayPosts: 1 });
		f.post(202, { created_at: shanghaiTodayStartUnix() + 1 });
		expect(await loadPublicStats(f.env)).toMatchObject({ totalThreads: 120, todayPosts: 2 });
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});
	it("rejects failed counter reads instead of caching zero", async () => {
		f.state.queryError = true;
		await expect(loadPublicStats(f.env)).rejects.toThrow();
	});
	it.each([null, { count: Number.NaN }])(
		"rejects invalid daily and activity count results %j",
		async (row) => {
			vi.spyOn(f.env.DB, "prepare").mockReturnValue({
				bind: () => ({ first: async () => row }),
			} as unknown as D1PreparedStatement);
			await expect(countPostsInDay(f.env)).rejects.toThrow("Daily post count was not returned");
			await expect(countRecentlyActiveUsers(f.env)).rejects.toThrow(
				"Online count was not returned",
			);
		},
	);
});
