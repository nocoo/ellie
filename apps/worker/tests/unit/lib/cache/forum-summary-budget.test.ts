import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadForumSnapshot } from "../../../../src/lib/cache/forum-read";
import { refreshDailyStatistics } from "../../../../src/lib/daily-statistics";
import { shanghaiTodayStartUnix } from "../../../../src/lib/shanghaiTime";
import { readingFixture } from "./thread-cache-fixture";

describe("forum summary query plan and row budget under high historical volume", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		f = readingFixture();
	});

	afterEach(() => f.close());

	it("serves persisted daily counts and bounded latest-thread lookups across 10,000 historical rows", async () => {
		const cutoff = shanghaiTodayStartUnix();

		// One SQL statement keeps large fixture setup cheap under coverage instrumentation.
		f.sqlite
			.prepare(`WITH RECURSIVE historical(n) AS (
				SELECT 1 UNION ALL SELECT n + 1 FROM historical WHERE n < 10000
			) INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at,
				last_post_at, last_poster_id, last_poster, sticky)
			SELECT 10000 + n, 1, 10, 'alice', 'Historical', ? + (n % 1000),
				? + (n % 1000), 20, 'bob', 0 FROM historical`)
			.run(cutoff - 100_000, cutoff - 100_000);

		// Seed 5 recent threads today in forum 1 and 2 recent in forum 2
		for (let i = 1; i <= 5; i++) {
			f.thread(30_000 + i, {
				forum_id: 1,
				created_at: cutoff + i * 100,
				last_post_at: cutoff + i * 100,
				sticky: 0,
			});
		}
		for (let i = 1; i <= 2; i++) {
			f.thread(40_000 + i, {
				forum_id: 2,
				created_at: cutoff + i * 100,
				last_post_at: cutoff + i * 100,
				sticky: 0,
			});
		}

		await refreshDailyStatistics(f.env);
		f.calls.length = 0;

		// Execute loadForumSnapshot and verify exact aggregated counts
		const snapshot = await loadForumSnapshot(f.env);
		const f1 = snapshot.find((row) => row.id === 1);
		const f2 = snapshot.find((row) => row.id === 2);

		expect(f1?.todayThreads).toBe(5);
		expect(f1?.lastThreadId).toBe(30_005);
		expect(f2?.todayThreads).toBe(2);
		expect(f2?.lastThreadId).toBe(40_002);

		// Explain Query Plan check derived directly from calls captured during execution
		const capturedLatestCall = f.calls.find((c) => c.sql.includes("last_thread_id"));
		expect(capturedLatestCall).toBeDefined();
		const latestExplain = f.sqlite
			.prepare(`EXPLAIN QUERY PLAN ${capturedLatestCall?.sql}`)
			.all() as { detail: string }[];

		// Must use partial covering index without temporary b-tree sort
		expect(
			latestExplain.some((row) =>
				row.detail.includes("SEARCH t USING INDEX idx_threads_forum_visible_created (forum_id=?)"),
			),
		).toBe(true);
		expect(latestExplain.some((row) => row.detail.includes("USE TEMP B-TREE"))).toBe(false);

		expect(f.calls).toHaveLength(1);
		expect(f.calls.some((call) => /COUNT\(|GROUP BY/.test(call.sql))).toBe(false);
	});
});
