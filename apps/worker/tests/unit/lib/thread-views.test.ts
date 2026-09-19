import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushThreadViews, scheduleThreadViewIncrement } from "../../../src/lib/thread-views";
import { readingFixture } from "./cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_700_000_000_000);

	f = readingFixture();
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("best-effort thread view aggregation", () => {
	it("100 reads cause zero writes until 60 seconds, then one atomic increment with no duplicate flush", async () => {
		f.thread(1);
		f.thread(2);
		for (let i = 0; i < 99; i++) scheduleThreadViewIncrement(f.env, f.ctx, 1);
		scheduleThreadViewIncrement(f.env, f.ctx, 2);
		vi.advanceTimersByTime(59_999);
		await flushThreadViews(f.env);
		expect(f.calls).toHaveLength(0);
		expect(f.ctx.waitUntil).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		scheduleThreadViewIncrement(f.env, f.ctx, 1);
		await Promise.all(f.ctx._waitUntilPromises);
		await Promise.all([flushThreadViews(f.env), flushThreadViews(f.env)]);
		expect(f.calls).toHaveLength(1);
		expect(f.sqlite.prepare("SELECT id, views FROM threads ORDER BY id").all()).toEqual([
			{ id: 1, views: 100 },
			{ id: 2, views: 1 },
		]);
		expect(f.ctx.waitUntil).toHaveBeenCalledOnce();
	});
	it("caps pending thread IDs and each SQL binding count", async () => {
		f.sqlite.exec(
			"WITH RECURSIVE ids(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM ids WHERE id < 2049) INSERT INTO threads (id, forum_id, author_id, subject, created_at, last_post_at) SELECT id, 1, 10, 'Budget fixture', id, id FROM ids",
		);
		for (let id = 1; id <= 2049; id++) scheduleThreadViewIncrement(f.env, f.ctx, id);
		vi.advanceTimersByTime(60_000);
		await flushThreadViews(f.env);
		expect(f.calls).toHaveLength(Math.ceil(2048 / 25));
		expect(Math.max(...f.calls.map((call) => call.params.length))).toBe(75);
		expect(f.sqlite.prepare("SELECT SUM(views) AS count FROM threads").get()).toEqual({
			count: 2048,
		});
	});
	it.each(["throw", "false"] as const)(
		"drops unconfirmed %s outcomes without retrying ambiguous writes",
		async (mode) => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			f.thread(1);
			scheduleThreadViewIncrement(f.env, f.ctx, 1);
			vi.advanceTimersByTime(60_000);
			vi.spyOn(f.env.DB, "prepare").mockImplementation(() => {
				if (mode === "throw") throw new Error("D1 unavailable");
				return {
					bind: () => ({ run: async () => ({ success: false }) }),
				} as unknown as D1PreparedStatement;
			});
			await flushThreadViews(f.env);
			await flushThreadViews(f.env);
			expect(f.env.DB.prepare).toHaveBeenCalledOnce();
		},
	);
	it("ignores invalid IDs and never flushes empty state", async () => {
		for (const id of [0, -1, NaN, Infinity, 1.5]) scheduleThreadViewIncrement(f.env, f.ctx, id);
		await flushThreadViews(f.env);

		expect(f.calls).toHaveLength(0);
	});
});
