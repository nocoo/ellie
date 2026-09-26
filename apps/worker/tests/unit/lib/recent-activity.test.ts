import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homeContext } from "../../../src/handlers/home";
import {
	markStatisticsForums,
	RECENT_ACTIVITY_KEY,
	readChangedForums,
	readRecentActivity,
	recordRecentActivity,
	refreshRecentActivity,
} from "../../../src/lib/recent-activity";
import { readingFixture } from "./cache/thread-cache-fixture";

const NOW = Date.parse("2026-09-25T02:00:00Z");
const SECOND = NOW / 1000;
const topic = {
	id: 1,
	forumId: 1,
	forumName: "Public",
	subject: "Recent",
	lastPostAt: SECOND,
	replies: 2,
};
const request = () =>
	new Request("https://worker.test/api/v1/home/context", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			cachedBucket: "anon",
			includeDisplay: false,
			includeStats: false,
			summaryTopicIds: [],
			digestTopicIds: [],
		}),
	});

describe("recent activity", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		f = readingFixture();
	});
	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("hydrates once, serves memory, and restores from KV after an isolate restart without D1", async () => {
		f.values.set(RECENT_ACTIVITY_KEY, JSON.stringify([topic]));
		expect(await readRecentActivity(f.env)).toEqual([topic]);
		expect(await readRecentActivity(f.env)).toEqual([topic]);
		expect(f.env.KV.get).toHaveBeenCalledTimes(1);
		expect(await readRecentActivity({ ...f.env, KV: { ...f.env.KV } })).toEqual([topic]);
		expect(f.env.KV.get).toHaveBeenCalledTimes(2);
		expect(f.calls).toHaveLength(0);
	});

	it("optimistically replaces and sorts activity, excludes future rows, and keeps quiet-day history", async () => {
		await recordRecentActivity(f.env, topic);
		await recordRecentActivity(f.env, { ...topic, id: 2, lastPostAt: SECOND - 20 });
		await recordRecentActivity(f.env, { ...topic, replies: 3 });
		await recordRecentActivity(f.env, { ...topic, id: 3, lastPostAt: SECOND + 1 });
		await recordRecentActivity(f.env, { ...topic, id: -1 });
		expect((await readRecentActivity(f.env)).map((row) => [row.id, row.replies])).toEqual([
			[1, 3],
			[2, 2],
		]);
		expect(f.env.KV.get).toHaveBeenCalledTimes(1);
		expect(f.calls).toHaveLength(0);
		vi.setSystemTime(NOW + 86_400_000);
		expect((await readRecentActivity(f.env)).map((row) => row.id)).toEqual([1, 2]);
		expect(f.calls).toHaveLength(0);
	});

	it("handles malformed or unavailable KV without foreground D1 or failed mutations", async () => {
		f.values.set(RECENT_ACTIVITY_KEY, JSON.stringify([{ ...topic, subject: "x".repeat(201) }]));
		expect(await readRecentActivity(f.env)).toEqual([]);
		f.state.writeError = true;
		await expect(recordRecentActivity(f.env, topic)).resolves.toBeUndefined();
		expect(await readRecentActivity(f.env)).toEqual([topic]);
		f.state.readError = true;
		vi.setSystemTime(NOW + 301_000);
		expect(await readRecentActivity(f.env)).toEqual([topic]);
		expect(await readRecentActivity({ ...f.env, KV: { ...f.env.KV } })).toEqual([]);
		expect(f.calls).toHaveLength(0);
	});

	it("refreshes with one indexed 24-hour query and retains forum IDs beyond the display bound", async () => {
		for (let id = 1; id <= 513; id++)
			f.thread(id, { last_post_at: SECOND - id, forum_id: id === 513 ? 2 : 1 });
		f.thread(514, { last_post_at: SECOND - 86_400 });
		f.thread(515, { last_post_at: SECOND, sticky: -1 });
		f.thread(516, { last_post_at: SECOND + 1 });
		expect(await refreshRecentActivity(f.env)).toEqual([1, 2]);
		expect(f.calls).toHaveLength(1);
		const query = f.calls[0];
		const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params);
		expect(JSON.stringify(plan)).toContain("SEARCH t USING INDEX idx_threads_latest");
		expect(JSON.stringify(plan)).toContain("SEARCH f USING INTEGER PRIMARY KEY");
		const rows = await readRecentActivity(f.env);
		expect(rows).toHaveLength(512);
		expect(rows[0].id).toBe(1);
		expect(rows.some((row) => row.id >= 513)).toBe(false);
	});

	it("backfills five authorized discussions from bounded history without marking quiet forums for recount", async () => {
		for (let id = 1; id <= 30; id++)
			f.thread(id, { last_post_at: SECOND - 86_400 - id, forum_id: id <= 3 ? 2 : 1 });
		f.thread(31, { last_post_at: SECOND - 86_400, sticky: -1 });
		f.thread(32, { last_post_at: SECOND + 1 });
		expect(await refreshRecentActivity(f.env)).toEqual([]);
		expect(f.calls).toHaveLength(1);
		const query = f.calls[0];
		const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${query.sql}`).all(...query.params);
		expect(JSON.stringify(plan)).toContain("SEARCH threads USING INDEX idx_threads_latest");
		expect(f.env.KV.put).toHaveBeenCalledTimes(1);
		expect(await readRecentActivity(f.env)).toHaveLength(20);
		vi.setSystemTime(NOW + 86_400_000);
		const restarted = { ...f.env, KV: { ...f.env.KV } };
		expect(await readRecentActivity(restarted)).toHaveLength(20);
		expect(f.calls).toHaveLength(1);
		vi.mocked(f.env.KV.get).mockClear();
		f.calls.length = 0;
		const body = await (await homeContext(request(), restarted)).json();
		expect(body.data.recent.map((row: { id: number }) => row.id)).toEqual([4, 5, 6, 7, 8]);
		expect(f.calls).toHaveLength(4);
		expect(f.env.KV.get).toHaveBeenCalledTimes(1);
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		await homeContext(request(), restarted);
		expect(f.calls).toHaveLength(2);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		f.sqlite.exec("DELETE FROM threads WHERE id=32");
		expect(await refreshRecentActivity(restarted)).toEqual([]);
		expect(await readRecentActivity(restarted)).toHaveLength(20);
	});

	it("keeps unique dirty markers for forum zero, deduplicates IDs, and pages across old markers", async () => {
		await markStatisticsForums(f.env, [0, 1, 1, -1, 1.5]);
		for (let id = 0; id < 1001; id++) f.values.set(`statistics:changed:v1:2:${id}`, "");
		const changed = await readChangedForums(f.env);
		expect(changed.forumIds).toEqual([0, 1, 2]);
		expect(changed.keys).toHaveLength(1003);
		expect(f.env.KV.list).toHaveBeenCalledTimes(2);
		f.state.writeError = true;
		await expect(markStatisticsForums(f.env, [1])).resolves.toBeUndefined();
	});

	it("shares home authority queries and removes hidden, moved, future and deleted candidates immediately", async () => {
		f.thread(1, { last_post_at: SECOND, replies: 2, anonymous_author: 1 });
		await recordRecentActivity(f.env, topic);
		vi.mocked(f.env.KV.get).mockClear();
		const load = async () => (await (await homeContext(request(), f.env)).json()).data;
		const body = await load();
		expect(body.recent).toEqual([{ ...topic, subject: "Thread 1" }]);
		expect(JSON.stringify(body.recent)).not.toContain("alice");
		expect(f.calls).toHaveLength(4);
		expect(f.env.KV.get).toHaveBeenCalledTimes(1);
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		await load();
		expect(f.calls).toHaveLength(2);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		for (const sql of [
			"UPDATE threads SET sticky=-1 WHERE id=1",
			"UPDATE threads SET sticky=0, forum_id=2 WHERE id=1",
			`UPDATE threads SET forum_id=1, last_post_at=${SECOND + 1} WHERE id=1`,
			"UPDATE threads SET last_post_at=0 WHERE id=1",
			`UPDATE threads SET last_post_at=${SECOND} WHERE id=1; UPDATE forums SET status=0 WHERE id=1`,
		]) {
			f.sqlite.exec(sql);
			expect((await load()).recent).toEqual([]);
		}
		f.sqlite.exec("UPDATE forums SET status=1 WHERE id=1; DELETE FROM threads WHERE id=1");
		expect((await load()).recent).toEqual([]);
		expect(f.env.KV.get).toHaveBeenCalledTimes(2);
	});
});
