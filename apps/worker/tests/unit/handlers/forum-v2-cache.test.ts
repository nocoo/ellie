import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAncestors, getById, list } from "../../../src/handlers/forum";
import { forumCacheKey } from "../../../src/lib/cache/forum-read";
import { bumpThreadMetaGen, invalidateUserCaches } from "../../../src/lib/cache/invalidate";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("forum structural/counter composition", () => {
	let f: ReturnType<typeof readingFixture>;
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-09-17T01:00:00Z"));
		f = readingFixture();
		f.sqlite.exec("UPDATE forums SET moderator_ids='30', moderators='mod' WHERE id=1");
		f.thread(10, { last_post_at: 100, last_poster_id: 10, last_poster: "old denormalized name" });
		f.thread(11, { last_post_at: 100, last_poster_id: 20, subject: "latest tied ID" });
	});
	afterEach(() => {
		f.close();
		vi.useRealTimers();
	});
	async function request(path = "/api/v1/forums", userId?: number, role = 0) {
		const headers: Record<string, string> = {};
		if (userId) headers.Authorization = `Bearer ${await createJwtForRole(role, userId)}`;
		const req = new Request(`https://test${path}`, { headers });
		const response = path.endsWith("ancestors")
			? await getAncestors(req, f.env, f.ctx)
			: path.split("?")[0] === "/api/v1/forums"
				? await list(req, f.env, f.ctx)
				: await getById(req, f.env, f.ctx);
		return { response, body: (await response.json()) as any };
	}
	it("name-only reads omit dynamic summaries and still enforce current visibility", async () => {
		const names = await request("/api/v1/forums?view=names");
		expect(names.body.data).toEqual([{ id: 1, name: "Public" }]);
		expect(f.calls.some(({ sql }) => /FROM threads|COUNT/.test(sql))).toBe(false);
		f.sqlite.exec("UPDATE forums SET visibility='staff' WHERE id=1");
		expect((await request("/api/v1/forums?view=names")).body.data).toEqual([]);
	});
	it("ancestor reads check only the current chain without loading latest threads", async () => {
		await request("/api/v1/forums/1/ancestors");
		f.calls.length = 0;
		const result = await request("/api/v1/forums/1/ancestors");
		expect(result.body.data.forum.id).toBe(1);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).toContain("WITH RECURSIVE chain");
		expect(f.calls[0].params).toEqual([1]);
		f.sqlite.exec("UPDATE forums SET parent_id=1 WHERE id=1");
		expect((await request("/api/v1/forums/1/ancestors")).body.data.ancestors).toEqual([]);
	});

	it("shares entity snapshots and uses only current forum/thread gates on hot list", async () => {
		const first = await request();
		expect(first.response.status).toBe(200);
		expect(first.body.data.map((row: any) => row.id)).toEqual([1]);
		expect(first.body.data[0]).toMatchObject({
			lastThreadId: 11,
			lastThreadSubject: "latest tied ID",
			lastPosterId: 20,
			lastPoster: "bob",
			moderatorList: [{ id: 30, name: "mod" }],
		});
		f.calls.length = 0;
		const puts = vi.mocked(f.env.KV.put).mock.calls.length;
		expect((await request()).body.data).toEqual(first.body.data);
		expect(f.calls).toHaveLength(2);
		expect(f.calls.every((call) => !/COUNT|\bsubject\b|FROM users/.test(call.sql))).toBe(true);
		expect(vi.mocked(f.env.KV.put).mock.calls).toHaveLength(puts);
	});
	it("keeps structural content LONG and dynamic membership SHORT with no copied names", async () => {
		await request();
		const tree = JSON.parse(
			f.values.get(
				await forumCacheKey(f.env, {
					family: "forum:tree:v2",
					params: { bucket: "anon" },
					scope: "role:anon",
				}),
			) ?? expect.fail("Missing forum snapshot"),
		);
		const summary = JSON.parse(
			f.values.get(
				await forumCacheKey(f.env, {
					family: "forum:summary:v2",
					params: { bucket: "anon" },
					scope: "role:anon",
				}),
			) ?? expect.fail("Missing forum snapshot"),
		);
		expect(tree.expiresAt - tree.loadedAt).toBe(86400000);
		expect(summary.expiresAt - summary.loadedAt).toBe(60000);
		expect(tree.data.forums[0].moderatorList).toEqual([]);
		expect(summary.data.aggregates[1]).toMatchObject({
			lastThreadSubject: "",
			lastPoster: "",
			lastPosterAvatar: "",
		});
		f.thread(12, { last_post_at: 300 });
		vi.setSystemTime(Date.now() + 59999);
		expect((await request()).body.data[0].lastThreadId).toBe(11);
		vi.setSystemTime(Date.now() + 1);
		expect((await request()).body.data[0].lastThreadId).toBe(12);
		expect(
			JSON.parse(
				f.values.get(
					await forumCacheKey(f.env, {
						family: "forum:tree:v2",
						params: { bucket: "anon" },
						scope: "role:anon",
					}),
				) ?? expect.fail("Missing forum snapshot"),
			).loadedAt,
		).toBe(tree.loadedAt);
	});
	it("renames and avatars flow through user mini instead of independent LONG copies", async () => {
		await request();
		f.sqlite.exec(
			"UPDATE users SET username='changed', avatar_path='changed.png' WHERE id=20; UPDATE users SET username='newmod' WHERE id=30",
		);
		await invalidateUserCaches(f.env, 20);
		await invalidateUserCaches(f.env, 30);
		expect((await request()).body.data[0]).toMatchObject({
			lastPoster: "changed",
			lastPosterAvatarPath: "changed.png",
			moderatorList: [{ id: 30, name: "newmod" }],
		});
	});
	it("subject edit refreshes the shared entity without replacing the forum snapshot", async () => {
		await request();
		f.sqlite.exec("UPDATE threads SET subject='edited' WHERE id=11");
		await bumpThreadMetaGen(f.env, 11);
		expect((await request()).body.data[0].lastThreadSubject).toBe("edited");
	});
	it.each([
		"DELETE FROM threads WHERE id=11",
		"UPDATE threads SET sticky=-1 WHERE id=11",
		"UPDATE threads SET forum_id=2 WHERE id=11",
	])("reselects a visible last thread after current removal: %s", async (sql) => {
		await request();
		f.sqlite.exec(sql);
		const row = (await request()).body.data[0];
		expect(row.lastThreadId).toBe(10);
		expect(row.lastPoster).toBe("alice");
	});
	it("clears last-thread fields when all candidates become hidden", async () => {
		await request();
		f.sqlite.exec("UPDATE threads SET sticky=-1");
		expect((await request()).body.data[0]).toMatchObject({
			lastThreadId: 0,
			lastThreadSubject: "",
			lastPosterId: 0,
			lastPosterAvatar: "",
		});
	});
	it("masks a newly anonymous last reply without waiting for cache propagation", async () => {
		await request();
		f.sqlite.exec("UPDATE threads SET anonymous_last_poster=1 WHERE id=11");
		expect((await request()).body.data[0]).toMatchObject({
			lastPosterId: 0,
			lastPoster: "匿名",
			lastPosterAvatar: "",
			lastPosterAvatarPath: "",
		});
	});
	it("current visibility and status hide previously cached forum payloads", async () => {
		await request();
		f.sqlite.exec("UPDATE forums SET visibility='staff' WHERE id=1");
		expect((await request()).body.data).toEqual([]);
		expect((await request("/api/v1/forums/1")).response.status).toBe(403);
		f.sqlite.exec("UPDATE forums SET status=0 WHERE id=1");
		expect((await request("/api/v1/forums/1")).response.status).toBe(404);
	});
	it.each([
		[undefined, 0, [1]],
		[10, 0, [1]],
		[30, 3, [1, 2]],
		[1, 1, [1, 2]],
	])("keeps audience data separate (%s/%s)", async (userId, role, ids) => {
		expect(
			(await request("/api/v1/forums", userId as number | undefined, role as number)).body.data.map(
				(row: any) => row.id,
			),
		).toEqual(ids);
	});
	it("single forum shares the list snapshots, and missing forum is not negative cached", async () => {
		await request();
		f.calls.length = 0;
		expect((await request("/api/v1/forums/1")).body.data.id).toBe(1);
		expect(f.calls).toHaveLength(2);
		const puts = vi.mocked(f.env.KV.put).mock.calls.length;
		expect((await request("/api/v1/forums/999")).response.status).toBe(404);
		expect(vi.mocked(f.env.KV.put).mock.calls).toHaveLength(puts);
	});
	it("breadcrumb cycles terminate while current hidden parents stay absent", async () => {
		f.sqlite.exec(
			"UPDATE forums SET parent_id=2 WHERE id=1; UPDATE forums SET parent_id=1 WHERE id=2",
		);
		const result = await request("/api/v1/forums/1/ancestors", 1, 1);
		expect(result.response.status).toBe(200);
		expect(result.body.data.ancestors).toEqual([{ id: 2, parentId: 1, name: "Staff" }]);
	});
	it("D1 failures reject current permission checks and never manufacture an empty cache", async () => {
		f.state.queryError = true;
		await expect(request()).rejects.toThrow();
		expect(f.values.size).toBe(0);
		f.state.queryError = false;
		expect((await request()).body.data[0].lastThreadId).toBe(11);
	});
});
