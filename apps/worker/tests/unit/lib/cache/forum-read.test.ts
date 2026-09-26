import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	forumCacheKey,
	getForumMetaV2,
	getForumSummaryV2,
	getForums,
	getForumTreeV2,
	loadForumSnapshot,
	rebuildForumCache,
} from "../../../../src/lib/cache/forum-read";
import { KV_REGISTRY } from "../../../../src/lib/cache/kv-registry";
import { inspectCacheEntry, rebuildCacheEntry } from "../../../../src/lib/cache/manage";
import { refreshDailyStatistics } from "../../../../src/lib/daily-statistics";
import { shanghaiTodayStartUnix } from "../../../../src/lib/shanghaiTime";
import { readingFixture } from "./thread-cache-fixture";

describe("forum origin budgets and pure rebuild", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		f = readingFixture();
	});
	afterEach(() => f.close());
	it.each([
		"UPDATE threads SET anonymous_author=1 WHERE id=52",
		"UPDATE threads SET sticky=-1 WHERE id=52",
		"UPDATE threads SET forum_id=2 WHERE id=52",
		"DELETE FROM threads WHERE id=52",
	])("reselects after a candidate changes during snapshot loading: %s", async (sql) => {
		f.thread(51, { created_at: 10 });
		f.thread(52, { created_at: 20 });
		const result = await getForumSummaryV2(f.env, f.ctx, "anon", async () => {
			const snapshot = await loadForumSnapshot(f.env);
			f.sqlite.exec(sql);
			return snapshot;
		});
		expect(result[1].lastThreadId).toBe(51);
		expect(result[1].lastPosterId).toBe(10);
		expect([...f.values.keys()].some((key) => key.includes("summary"))).toBe(false);
	});

	it("hides a replacement moved to a restricted forum before its final gate", async () => {
		f.thread(51, { created_at: 10 });
		f.thread(52, { created_at: 20 });
		const result = await getForumSummaryV2(f.env, f.ctx, "anon", async () => {
			const snapshot = await loadForumSnapshot(f.env);
			f.sqlite.exec("UPDATE threads SET anonymous_author=1 WHERE id=52");
			f.state.afterRead = async (sql) => {
				if (sql.includes("WHERE f.id IN")) {
					f.sqlite.exec("UPDATE threads SET forum_id=2 WHERE id=51");
				}
			};
			return snapshot;
		});
		expect(result[1].lastThreadId).toBe(0);
		expect(result[1].lastPosterId).toBe(0);
		expect(result[1].lastThreadSubject).toBe("");
	});
	it("chooses the higher ID on same-second ties with one indexed query per forum", async () => {
		f.thread(100, { created_at: 1700000000, last_post_at: 1 });
		f.thread(200, { created_at: 1700000000, last_post_at: 1 });
		const rows = await loadForumSnapshot(f.env);
		expect(rows.find((row) => row.id === 1)?.lastThreadId).toBe(200);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).toContain("ORDER BY t.created_at DESC, t.id DESC LIMIT 1");
	});
	it("limits latest-topic lookups to the requested forum and skips an empty scope", async () => {
		f.thread(10);
		f.thread(20, { forum_id: 2 });
		const result = await getForumMetaV2(f.env, f.ctx, 1, "anon");
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") expect(result.forum.lastThreadId).toBe(10);
		const latest = f.calls.filter((call) => call.sql.startsWith("SELECT f.id, f.status"));
		expect(latest).toHaveLength(1);
		expect(latest[0].params).toEqual(["[1]"]);
		f.calls.length = 0;
		expect(await loadForumSnapshot(f.env, [])).toEqual([]);
		expect(f.calls).toHaveLength(0);
	});

	it("250 moderator IDs load only misses in bounded user batches", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => i + 100);
		for (const id of ids) f.insert("users", { id, username: `u${id}` });
		f.sqlite.prepare("UPDATE forums SET moderator_ids=? WHERE id=1").run(ids.join(","));
		const nodes = await getForumTreeV2(f.env, f.ctx, "anon");
		expect(nodes[0].moderatorList).toHaveLength(250);
		const batches = f.calls.filter((call) => /FROM users/.test(call.sql));
		expect(batches.map((call) => call.params.length)).toEqual([80, 80, 80, 10]);
		f.calls.length = 0;
		await getForumTreeV2(f.env, f.ctx, "anon");
		expect(f.calls).toHaveLength(0);
	});
	it("compares disabled and enabled cache on the same dataset and sequence", async () => {
		f.thread(10);
		f.sqlite.exec("UPDATE forums SET moderator_ids='30' WHERE id=1");
		const disabled = {
			...f.env,
			CACHE_DISABLED_FAMILIES: KV_REGISTRY.filter((row) => row.tier)
				.map((row) => row.family)
				.join(","),
		};
		const first = await getForums(disabled, undefined, "anon");
		f.calls.length = 0;
		await getForums(disabled, undefined, "anon");
		const baseline = f.calls.length;
		f.calls.length = 0;
		expect(await getForums(f.env, undefined, "anon")).toEqual(first);
		f.calls.length = 0;
		for (let i = 0; i < 20; i++) expect(await getForums(f.env, undefined, "anon")).toEqual(first);
		expect(f.calls.length).toBeGreaterThan(0);
		expect(f.calls.every((call) => /anonymous_author/.test(call.sql))).toBe(true);
		expect(baseline).toBeGreaterThan(2);
		expect(f.calls.every((call) => call.mode === "all")).toBe(true);
	});
	it("inspect and rebuild retain original bucket, execute no effects, and preview is read-only", async () => {
		f.thread(10);
		await getForums(f.env, f.ctx, "anon");
		const d = { family: "forum:tree:v2", params: { bucket: "anon" }, scope: "role:anon" };
		const key = await forumCacheKey(f.env, d);
		f.calls.length = 0;
		const puts = vi.mocked(f.env.KV.put).mock.calls.length;
		const before = await inspectCacheEntry(f.env, key);
		expect(before.valid).toBe(true);
		expect(f.calls).toHaveLength(0);
		expect(vi.mocked(f.env.KV.put).mock.calls).toHaveLength(puts);
		f.sqlite.exec("UPDATE forums SET name='Changed' WHERE id=1");
		const entry = await rebuildCacheEntry(f.env, f.ctx, key);
		expect((entry.data as any).forums[0].name).toBe("Changed");
		expect((entry.data as any).forums.map((row: any) => row.id)).toEqual([1]);
		expect(entry.tier).toBe("HOUR");
		expect(f.calls.every((call) => call.mode === "all")).toBe(true);
	});
	it.each([
		{ family: "other", params: { bucket: "anon" }, scope: "role:anon" },
		{ family: "forum:tree:v2", params: { bucket: "bogus" }, scope: "role:bogus" },
		{ family: "forum:tree:v2", params: { bucket: "anon", sql: "DROP" }, scope: "role:anon" },
	])("rejects forged descriptors without business reads", async (d) => {
		await expect(rebuildForumCache(f.env, undefined, d)).rejects.toThrow();
		expect(f.calls).toHaveLength(0);
	});

	it("reads stored daily counts and uses the latest-thread index without request-time aggregation", async () => {
		// Populate realistic distribution: old threads (past cutoff) and new threads
		const cutoff = shanghaiTodayStartUnix();
		for (let id = 1000; id <= 1050; id++) {
			f.thread(id, {
				forum_id: 1,
				created_at: cutoff - 5000,
				last_post_at: cutoff - 5000 + id,
				sticky: 0,
			});
		}
		// 3 recent threads today
		f.thread(2001, {
			forum_id: 1,
			created_at: cutoff + 100,
			last_post_at: cutoff + 1000,
			sticky: 0,
		});
		f.thread(2002, {
			forum_id: 1,
			created_at: cutoff + 200,
			last_post_at: cutoff + 2000,
			sticky: 0,
		});
		// Thread with negative sticky (soft deleted / hidden) should be excluded
		f.thread(2003, {
			forum_id: 1,
			created_at: cutoff + 300,
			last_post_at: cutoff + 3000,
			sticky: -1,
		});

		await refreshDailyStatistics(f.env);
		f.calls.length = 0;

		// Execute loadForumSnapshot and verify calls captured
		const snapshot = await loadForumSnapshot(f.env);
		const forum1 = snapshot.find((row) => row.id === 1);
		expect(forum1).toBeDefined();
		expect(forum1?.lastThreadId).toBe(2002);
		expect(forum1?.todayThreads).toBe(2); // 2001 and 2002, excluding 2003 (sticky: -1)

		// Derive EXPLAIN directly from actual queries captured by loadForumSnapshot
		const capturedLatestSql = f.calls.find((c) => c.sql.includes("last_thread_id"))?.sql;
		expect(capturedLatestSql).toBeDefined();
		const latestExplain = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${capturedLatestSql}`).all() as {
			detail: string;
		}[];

		expect(
			latestExplain.some((step) =>
				step.detail.includes("SEARCH t USING INDEX idx_threads_forum_visible_created"),
			),
		).toBe(true);
		expect(latestExplain.some((step) => step.detail.includes("USE TEMP B-TREE FOR ORDER BY"))).toBe(
			false,
		);

		expect(f.calls).toHaveLength(1);
		expect(f.calls.some((call) => /COUNT\(|GROUP BY/.test(call.sql))).toBe(false);
	});

	it("reads current visible topics with the creation-time tie-breaker after hiding a topic", async () => {
		// Populate initial candidate threads
		f.thread(301, { forum_id: 1, created_at: 1700000000, last_post_at: 1700000010, sticky: 0 });
		f.thread(302, { forum_id: 1, created_at: 1700000000, last_post_at: 1700000000, sticky: 0 });
		f.thread(303, { forum_id: 1, created_at: 1700000005, sticky: -1 });

		const forums1 = await getForums(f.env, f.ctx, "anon");
		expect(forums1.find((m) => m.id === 1)?.lastThreadId).toBe(302);

		// Now remove/hide the cached newest thread (302) by setting sticky = -1 (or moving forum_id)
		f.sqlite.prepare("UPDATE threads SET sticky = -1 WHERE id = 302").run();

		// Add another candidate with same timestamp as 301 but lower id, to verify tie-breaking on fallback
		f.thread(300, { forum_id: 1, created_at: 1700000000, last_post_at: 1700000020, sticky: 0 });

		f.calls.length = 0;

		const forums2 = await getForums(f.env, f.ctx, "anon");
		const f1After = forums2.find((m) => m.id === 1);

		// The fresh query chooses the next visible topic, breaking creation-time ties by ID.
		expect(f1After?.lastThreadId).toBe(301);

		// Verify the current-topic query uses the covering order index.
		const topicCall = f.calls.find((c) =>
			c.sql.includes("FROM forums f LEFT JOIN threads t ON t.id"),
		);
		expect(topicCall).toBeDefined();

		const topicExplain = f.sqlite
			.prepare(`EXPLAIN QUERY PLAN ${topicCall?.sql}`)
			.all(...(topicCall?.params ?? [])) as { detail: string }[];
		expect(
			topicExplain.some((step) =>
				step.detail.includes("SEARCH t USING INDEX idx_threads_forum_visible_created"),
			),
		).toBe(true);
		expect(topicExplain.some((step) => step.detail.includes("USE TEMP B-TREE FOR ORDER BY"))).toBe(
			false,
		);
	});
});
