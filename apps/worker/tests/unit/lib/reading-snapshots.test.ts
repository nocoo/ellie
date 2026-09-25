import { afterEach, describe, expect, it, vi } from "vitest";
import { forumListContext } from "../../../src/handlers/forum-list";
import { bumpForumTreeGen, bumpRecommendedGen } from "../../../src/lib/cache/invalidate";
import { DAILY_STATISTICS_KEY, refreshDailyStatistics } from "../../../src/lib/daily-statistics";
import {
	decodeForumReadSnapshot,
	encodeForumReadSnapshot,
	invalidateReadingConfig,
	isReadingConfig,
	isReadingMembership,
	isReadingRecommendations,
	persistReadingSnapshot,
	READING_CONFIG_TTL_MS,
	READING_MEMBERSHIP_TTL_MS,
	READING_SNAPSHOT_MAX_BYTES,
	restoreReadingSnapshot,
	validReadingSnapshot,
} from "../../../src/lib/reading-snapshots";
import { readingFixture } from "./cache/thread-cache-fixture";

function request(overrides: Record<string, unknown> = {}) {
	return new Request("https://api.example.com/api/v1/forums/context", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			forumId: 1,
			page: 1,
			limit: 20,
			typeId: null,
			cachedBucket: "anon",
			cachedRevision: null,
			cachedRead: null,
			includeDisplay: true,
			includeStats: false,
			includeCount: false,
			...overrides,
		}),
	});
}

describe("bounded reading snapshots", () => {
	let f: ReturnType<typeof readingFixture>;
	afterEach(() => {
		f?.close();
		vi.restoreAllMocks();
	});
	async function cold() {
		f = readingFixture();
		f.thread(8, { last_post_at: 100 });
		const response = await forumListContext(request(), f.env);
		expect(response.status).toBe(200);
		return (await response.json()).data;
	}

	it("invalidates configuration after a confirmed admin write without touching statistics", async () => {
		await cold();
		await f.env.KV.put("statistics:daily:v1", "retained");
		expect(await f.env.KV.get("reading:v1:config:1:anon")).not.toBeNull();
		await bumpForumTreeGen(f.env);
		expect(await f.env.KV.get("reading:v1:config:1:anon")).toBeNull();
		expect(await f.env.KV.get("statistics:daily:v1")).toBe("retained");
		await f.env.KV.put("reading:v1:recommended:1", "old");
		await f.env.KV.put("reading:v1:recommended:2", "other");
		await bumpRecommendedGen(f.env, 1);
		expect(await f.env.KV.get("reading:v1:recommended:1")).toBeNull();
		expect(await f.env.KV.get("reading:v1:recommended:2")).toBe("other");
	});

	it("paginates configuration invalidation, bounds work and tolerates storage failure", async () => {
		await cold();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.mocked(f.env.KV.list)
			.mockResolvedValueOnce({
				keys: Array.from({ length: 51 }, (_, id) => ({ name: `reading:v1:config:${id}:anon` })),
				list_complete: false,
				cursor: "next",
				cacheStatus: null,
			})
			.mockResolvedValueOnce({ keys: [], list_complete: true, cacheStatus: null });
		vi.mocked(f.env.KV.delete).mockClear();
		await invalidateReadingConfig(f.env);
		expect(f.env.KV.delete).toHaveBeenCalledTimes(51);
		expect(f.env.KV.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next" }));
		vi.mocked(f.env.KV.list)
			.mockClear()
			.mockResolvedValue({ keys: [], list_complete: false, cursor: "stuck", cacheStatus: null });
		await invalidateReadingConfig(f.env);
		expect(f.env.KV.list).toHaveBeenCalledTimes(16);
		vi.mocked(f.env.KV.list).mockRejectedValue(new Error("offline"));
		await expect(invalidateReadingConfig(f.env)).resolves.toBeUndefined();
		vi.mocked(f.env.KV.delete).mockRejectedValue(new Error("offline"));
		await expect(bumpRecommendedGen(f.env, 1)).resolves.toBeTypeOf("string");
	});

	it("restores selections after restart and performs only scoped authority and topic gates on warm reads", async () => {
		const data = await cold();
		for (let id = 50; id < 250; id++) f.insert("forums", { id, name: `Unrelated ${id}` });
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		vi.mocked(f.env.KV.put).mockClear();
		const warm = await forumListContext(
			request({
				cachedRevision: data.revision,
				cachedRead: data.readSnapshot,
				includeDisplay: false,
			}),
			f.env,
		);
		expect(warm.status).toBe(200);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.calls).toHaveLength(2);
		expect(f.calls[0]?.params).toEqual(["[1]"]);
		const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${f.calls[0]?.sql}`).all("[1]");
		expect(JSON.stringify(plan)).toContain("SEARCH forums USING INTEGER PRIMARY KEY");
		expect(JSON.stringify(plan)).toContain("SEARCH f USING INTEGER PRIMARY KEY");
		f.calls.length = 0;
		await forumListContext(
			request({ cachedRevision: data.revision, includeDisplay: false }),
			f.env,
		);
		expect(f.env.KV.get).toHaveBeenCalledTimes(3);
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.calls).toHaveLength(2);
	});

	it("checks newly assigned ancestors, even when the supplied configuration predates the move", async () => {
		const data = await cold();
		f.sqlite.exec("UPDATE forums SET parent_id = 2 WHERE id = 1");
		expect((await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).status).toBe(
			403,
		);
		f.sqlite.exec("UPDATE forums SET status = 0 WHERE id = 2");
		expect((await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).status).toBe(
			404,
		);
		f.sqlite.exec("UPDATE forums SET status = 1, parent_id = 1 WHERE id = 2");
		expect((await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).status).toBe(
			404,
		);
	});

	it("never returns newly restricted child text inside an opaque snapshot", async () => {
		await cold();
		f.insert("forums", { id: 4, parent_id: 1, name: "Previously public child" });
		f.values.delete("reading:v1:config:1:anon");
		const first = (await (await forumListContext(request(), f.env)).json()).data;
		f.sqlite.exec("UPDATE forums SET visibility = 'staff' WHERE id = 4");
		const hidden = (
			await (await forumListContext(request({ cachedRead: first.readSnapshot }), f.env)).json()
		).data;
		expect(hidden.display.forums.map((row: { id: number }) => row.id)).not.toContain(4);
		expect(hidden.readSnapshot).not.toContain("Previously public child");
	});

	it("keeps ordering and configuration until their distinct deadlines, without COUNT", async () => {
		const initial = Date.now();
		vi.spyOn(Date, "now").mockReturnValue(initial);
		const data = await cold();
		f.thread(9, { last_post_at: 200 });
		f.sqlite.exec("UPDATE forums SET name = 'Changed' WHERE id = 1");
		const same = (
			await (await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).json()
		).data;
		expect(same.display.threads.map((row: { id: number }) => row.id)).toEqual([8]);
		expect(same.display.forums[0].name).toBe("Public");
		vi.mocked(Date.now).mockReturnValue(initial + READING_MEMBERSHIP_TTL_MS);
		const reordered = (
			await (await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).json()
		).data;
		expect(reordered.display.threads.map((row: { id: number }) => row.id)).toEqual([9, 8]);
		expect(reordered.display.forums[0].name).toBe("Public");
		vi.mocked(Date.now).mockReturnValue(initial + READING_CONFIG_TTL_MS);
		const renamed = (
			await (await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).json()
		).data;
		expect(renamed.display.forums[0].name).toBe("Changed");
		expect(f.calls.some((call) => call.sql.includes("COUNT(*)"))).toBe(false);
	});

	it("does not persist deep-page membership or accept a different page's membership", async () => {
		const data = await cold();
		const deep = (
			await (
				await forumListContext(request({ page: 4, cachedRead: data.readSnapshot }), f.env)
			).json()
		).data;
		expect(deep.display.threads).toEqual([]);
		const decoded = await decodeForumReadSnapshot(f.env, deep.readSnapshot, 1, "anon");
		expect(decoded?.page).toBeNull();
		expect([...f.values.keys()].filter((key) => key.startsWith("reading:v1:page:"))).toEqual([
			"reading:v1:page:1:anon:all:20:1",
		]);
		const second = (
			await (
				await forumListContext(request({ page: 2, cachedRead: data.readSnapshot }), f.env)
			).json()
		).data;
		expect(second.display.threads).toEqual([]);
	});

	it("rejects forged, wrong-bucket, wrong-forum and oversized tokens", async () => {
		const data = await cold();
		expect(await decodeForumReadSnapshot(f.env, data.readSnapshot, 1, "anon")).not.toBeNull();
		expect(await decodeForumReadSnapshot(f.env, data.readSnapshot, 2, "anon")).toBeNull();
		expect(await decodeForumReadSnapshot(f.env, data.readSnapshot, 1, "member")).toBeNull();
		expect(
			await decodeForumReadSnapshot(
				f.env,
				data.readSnapshot.replace("Public", "Injected"),
				1,
				"anon",
			),
		).toBeNull();
		expect(await decodeForumReadSnapshot(f.env, `${"0".repeat(64)}:{`, 1, "anon")).toBeNull();
		expect(await decodeForumReadSnapshot(f.env, "invalid", 1, "anon")).toBeNull();
		expect(await decodeForumReadSnapshot(f.env, null, 1, "anon")).toBeNull();
		expect(
			await decodeForumReadSnapshot(f.env, "x".repeat(READING_SNAPSHOT_MAX_BYTES + 1), 1, "anon"),
		).toBeNull();
		const decoded = await decodeForumReadSnapshot(f.env, data.readSnapshot, 1, "anon");
		if (!decoded) throw new Error("Missing snapshot");
		const forum = decoded.config.data.forums[0];
		if (!forum) throw new Error("Missing forum");
		forum.description = "x".repeat(READING_SNAPSHOT_MAX_BYTES);
		expect(await encodeForumReadSnapshot(f.env, decoded)).toBeNull();
	});

	it("continues through unavailable or malformed KV without restoring a count query", async () => {
		await cold();
		f.values.clear();
		f.state.readError = true;
		f.state.writeError = true;
		const response = await forumListContext(request(), f.env);
		expect(response.status).toBe(200);
		expect(f.calls.some((call) => call.sql.includes("COUNT(*)"))).toBe(false);
		f.state.readError = false;
		f.state.writeError = false;
		const validate = (data: unknown): data is number[] =>
			Array.isArray(data) && data.every(Number.isInteger);
		for (const raw of [
			"{",
			"null",
			JSON.stringify({ createdAt: Date.now() + 1_000, data: [] }),
			"x".repeat(READING_SNAPSHOT_MAX_BYTES + 1),
		]) {
			f.values.set("test", raw);
			expect(await restoreReadingSnapshot(f.env, "test", 100, validate, null)).toBeNull();
		}
		const before = vi.mocked(f.env.KV.put).mock.calls.length;
		await persistReadingSnapshot(f.env, "huge", 1000, "x".repeat(READING_SNAPSHOT_MAX_BYTES));
		expect(vi.mocked(f.env.KV.put).mock.calls.length).toBe(before);
	});

	it("fails closed on failed authority reads and bounds changed ancestor chains", async () => {
		const data = await cold();
		f.state.queryError = true;
		await expect(
			forumListContext(request({ cachedRead: data.readSnapshot }), f.env),
		).rejects.toThrow("Forum authority");
		await expect(forumListContext(request({ forumId: 2 }), f.env)).rejects.toThrow(
			"Forum authority",
		);
		f.state.queryError = false;
		f.sqlite.prepare("UPDATE forums SET moderator_ids = ? WHERE id = 1").run("1,".repeat(1025));
		expect((await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).status).toBe(
			503,
		);
		f.sqlite.exec("UPDATE forums SET moderator_ids = '', parent_id = 50 WHERE id = 1");
		for (let id = 50; id <= 2100; id++)
			f.insert("forums", { id, parent_id: id === 2100 ? 0 : id + 1, name: `Ancestor ${id}` });
		expect((await forumListContext(request({ cachedRead: data.readSnapshot }), f.env)).status).toBe(
			503,
		);
	});

	it("serves old callers daily local or typed estimates plus only authorized global announcements", async () => {
		await cold();
		f.sqlite.exec(
			"UPDATE forums SET thread_types_enabled = 1, thread_types_listable = 1 WHERE id = 1",
		);
		f.insert("forum_thread_types", { id: 7, forum_id: 1, name: "News", enabled: 1 });
		f.sqlite.exec("UPDATE threads SET type_id = 7 WHERE id = 8");
		f.thread(9, { sticky: 2, type_id: 7 });
		f.insert("forums", { id: 4, name: "Public pin source" });
		f.thread(10, { sticky: 2, forum_id: 4 });
		f.thread(11, { sticky: 2, forum_id: 2 });
		await refreshDailyStatistics(f.env);
		f.thread(12, { type_id: 7 });
		f.values.delete("reading:v1:config:1:anon");
		f.values.delete("reading:v1:page:1:anon:all:20:1");
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		const data = (
			await (
				await forumListContext(
					request({ cachedRead: undefined, includeCount: true, includeStats: true }),
					f.env,
				)
			).json()
		).data;
		expect(data.count).toBe(3);
		expect(data.announcementCount).toBe(2);
		expect(data.count - data.announcementCount).toBe(1);
		expect(data.display.threads.some((row: { id: number }) => row.id === 12)).toBe(true);
		expect(
			vi.mocked(f.env.KV.get).mock.calls.filter(([key]) => key === DAILY_STATISTICS_KEY),
		).toHaveLength(1);
		const typed = (
			await (
				await forumListContext(
					request({ typeId: 7, includeCount: true, cachedRead: data.readSnapshot }),
					f.env,
				)
			).json()
		).data;
		expect(typed.count).toBe(2);
		expect(typed.announcementCount).toBe(0);
		expect(f.calls.some((call) => call.sql.includes("COUNT(*)"))).toBe(false);
	});

	it("keeps cold old callers available with zero local estimates during missing or failed KV", async () => {
		const warm = await cold();
		f.thread(9, { sticky: 2 });
		f.values.delete("reading:v1:page:1:anon:all:20:1");
		const missing = (
			await (
				await forumListContext(request({ cachedRead: undefined, includeCount: true }), f.env)
			).json()
		).data;
		expect(missing.announcementCount).toBe(1);
		expect(missing.count - missing.announcementCount).toBe(0);
		f.state.readError = true;
		const failed = await forumListContext(
			request({ cachedRead: undefined, includeCount: true }),
			f.env,
		);
		expect(failed.status).toBe(200);
		const body = (await failed.json()).data;
		expect(body.count - body.announcementCount).toBe(0);
		vi.mocked(f.env.KV.get).mockClear();
		const current = await forumListContext(
			request({
				cachedRead: warm.readSnapshot,
				cachedRevision: warm.revision,
				includeDisplay: false,
			}),
			f.env,
		);
		expect(current.status).toBe(200);
		expect((await current.json()).data.count).toBeUndefined();
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.calls.some((call) => call.sql.includes("COUNT(*)"))).toBe(false);
	});

	it("rejects malformed or unbounded persisted selections", () => {
		f = readingFixture();
		expect(isReadingConfig(null)).toBe(false);
		expect(isReadingConfig({ forums: Array(2049).fill({}), threadTypes: {} })).toBe(false);
		expect(isReadingConfig({ forums: [{}], threadTypes: {} })).toBe(false);
		expect(isReadingRecommendations([{ id: 0, recommendedAt: 1 }])).toBe(false);
		expect(isReadingRecommendations(Array(7).fill({ id: 1, recommendedAt: 1 }))).toBe(false);
		expect(
			isReadingMembership({ page: 4, limit: 1, typeId: null, window: [], announcements: [] }),
		).toBe(false);
		expect(
			isReadingMembership({
				page: 1,
				limit: 1,
				typeId: null,
				window: [{ id: 1, sticky: -1, last_post_at: 0 }],
				announcements: [],
			}),
		).toBe(false);
		expect(
			isReadingMembership({
				page: 1,
				limit: 1,
				typeId: null,
				window: [],
				announcements: [{ id: 1, sticky: 2, last_post_at: 0, forum_id: 0 }],
			}),
		).toBe(false);
		expect(
			validReadingSnapshot({ createdAt: 100, data: [] }, 10, isReadingRecommendations, 110),
		).toBe(false);
	});
});
