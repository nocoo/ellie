import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	forumCacheKey,
	getForums,
	getForumTreeV2,
	loadForumSnapshot,
	rebuildForumCache,
} from "../../../../src/lib/cache/forum-read";
import { KV_REGISTRY } from "../../../../src/lib/cache/kv-registry";
import { inspectCacheEntry, rebuildCacheEntry } from "../../../../src/lib/cache/manage";
import { readingFixture } from "./thread-cache-fixture";

describe("forum origin budgets and pure rebuild", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		f = readingFixture();
	});
	afterEach(() => f.close());
	it("chooses the higher ID on same-second ties with one indexed query per forum", async () => {
		f.thread(100, { last_post_at: 1700000000 });
		f.thread(200, { last_post_at: 1700000000 });
		const rows = await loadForumSnapshot(f.env);
		expect(rows.find((row) => row.id === 1)?.lastThreadId).toBe(200);
		expect(f.calls).toHaveLength(2);
		expect(f.calls[0].sql).toContain("ORDER BY t.last_post_at DESC, t.id DESC LIMIT 1");
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
		expect(f.calls).toHaveLength(1);
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
		expect(f.calls).toHaveLength(40);
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
		expect(entry.tier).toBe("LONG");
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
});
