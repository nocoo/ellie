import { afterEach, describe, expect, it } from "vitest";
import { forumListContext } from "../../../src/handlers/forum-list";
import { createJwt } from "../../../src/lib/jwt";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

function post(body: unknown, headers?: Record<string, string>): Request {
	return new Request("https://api.example.com/api/v1/forums/context", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

function request(overrides: Record<string, unknown> = {}) {
	return {
		forumId: 1,
		page: 1,
		limit: 20,
		typeId: null,
		cachedBucket: "anon",
		cachedRevision: null,
		includeDisplay: false,
		includeStats: false,
		includeCount: false,
		...overrides,
	};
}

describe("POST /api/v1/forums/context", () => {
	let f: ReturnType<typeof readingFixture>;

	afterEach(() => {
		f?.close();
	});

	function open() {
		f = readingFixture();
		return f;
	}

	it("returns a no-store page from D1 and ignores KV, including after a restart", async () => {
		open();
		f.values.set("cache:v3:thread:list:stale", '{"items":[{"id":999}]}');
		f.thread(8, { subject: "Live", replies: 3, views: 9 });
		f.sqlite.exec("UPDATE forums SET threads = 12, posts = 34 WHERE id = 1");
		const cold = await forumListContext(post(request({ includeDisplay: true })), f.env);
		expect(cold.status).toBe(200);
		expect(cold.headers.get("cache-control")).toContain("no-store");
		const body = await cold.json();
		expect(body.data.bucket).toBe("anon");
		expect(body.data.user).toBeNull();
		expect(body.data.revision).toMatch(/^[a-f0-9]{64}$/);
		expect(body.data.display.threads.map((row: { subject: string }) => row.subject)).toEqual([
			"Live",
		]);
		expect(body.data.display.forums[0]).toMatchObject({
			id: 1,
			threads: 12,
			posts: 34,
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastPosterId: 0,
			lastThreadSubject: "",
		});
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.calls.some((call) => call.mode === "run")).toBe(false);

		f.sqlite.exec("UPDATE threads SET subject = 'After restart', views = 99 WHERE id = 8");
		const restarted = await forumListContext(
			post(request({ includeDisplay: true, cachedRevision: body.data.revision })),
			f.env,
		);
		const next = await restarted.json();
		expect(next.data.display.threads[0].subject).toBe("After restart");
		expect(next.data.display.threads[0].views).toBe(99);
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});

	it("keeps a warm same-revision read free of display, count, KV and entity text", async () => {
		open();
		f.thread(8, { subject: "Warm", views: 1 });
		const cold = await (await forumListContext(post(request()), f.env)).json();
		f.calls.length = 0;
		f.sqlite.exec("UPDATE threads SET views = 50, subject = 'Edited later' WHERE id = 8");
		const hot = await forumListContext(
			post(
				request({
					cachedBucket: "anon",
					cachedRevision: cold.data.revision,
					includeDisplay: false,
					includeCount: false,
				}),
			),
			f.env,
		);
		const body = await hot.json();
		expect(hot.status).toBe(200);
		expect(body.data.revision).toBe(cold.data.revision);
		expect(body.data.display).toBeUndefined();
		expect(body.data.count).toBeUndefined();
		expect(body.data.hasNext).toBe(false);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		const sql = f.calls.map((call) => call.sql).join("\n");
		expect(sql).not.toContain("COUNT(*)");
		expect(sql).not.toContain("t.subject");
		expect(sql).not.toContain("t.views");
		expect(sql).not.toContain("description");
		expect(sql).not.toContain("announcement,");
	});

	it("returns count without display when a warm page asks for includeCount", async () => {
		open();
		f.thread(8, { sticky: 2, last_post_at: 30 });
		f.thread(9, { sticky: 0, last_post_at: 20 });
		const cold = await (await forumListContext(post(request()), f.env)).json();
		const hot = await forumListContext(
			post(
				request({
					cachedRevision: cold.data.revision,
					includeDisplay: false,
					includeCount: true,
				}),
			),
			f.env,
		);
		const body = await hot.json();
		expect(body.data.display).toBeUndefined();
		expect(body.data.count).toBe(2);
	});

	it.each([
		["UPDATE threads SET sticky = -1 WHERE id = 8", true],
		["DELETE FROM threads WHERE id = 8", true],
		["UPDATE threads SET forum_id = 2 WHERE id = 8", true],
		["UPDATE threads SET anonymous_author = 1, anonymous_last_poster = 1 WHERE id = 8", false],
	] as const)("refreshes a warm snapshot after %s", async (sql, removed) => {
		open();
		f.thread(8, { last_post_at: 30 });
		f.thread(9, { last_post_at: 20 });
		const cold = await (await forumListContext(post(request()), f.env)).json();
		f.sqlite.exec(sql);
		const response = await forumListContext(
			post(request({ cachedRevision: cold.data.revision })),
			f.env,
		);
		expect(response.status).toBe(200);
		const next = await response.json();
		expect(next.data.revision).not.toBe(cold.data.revision);
		expect(next.data.count).toBeUndefined();
		const changed = next.data.display.threads.find((row: { id: number }) => row.id === 8);
		if (removed) expect(changed).toBeUndefined();
		else
			expect(changed).toMatchObject({
				authorId: 0,
				authorName: "匿名",
				lastPosterId: 0,
				lastPoster: "匿名",
			});
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});

	it("masks anonymous authors and last posters for the owner and for staff before profiles", async () => {
		open();
		f.thread(8, {
			subject: "Secret",
			anonymous_author: 1,
			anonymous_last_poster: 1,
			author_id: 10,
			last_poster_id: 20,
		});
		f.thread(9, {
			subject: "Open",
			author_id: 10,
			last_poster_id: 10,
			last_poster: "alice",
			last_post_at: 1,
		});
		await f.env.DB.prepare("UPDATE users SET username = ? WHERE id = ?").bind("Renamed", 10).run();
		for (const userId of [10, 1]) {
			f.calls.length = 0;
			const jwt = await createJwtForRole(userId === 1 ? 1 : 0, userId, f.env.JWT_SECRET);
			const response = await forumListContext(
				post(request({ includeDisplay: true }), { authorization: `Bearer ${jwt}` }),
				f.env,
			);
			expect(response.status).toBe(200);
			const body = await response.json();
			const secret = body.data.display.threads.find((row: { id: number }) => row.id === 8);
			const open = body.data.display.threads.find((row: { id: number }) => row.id === 9);
			expect(secret).toMatchObject({
				authorId: 0,
				authorName: "匿名",
				lastPosterId: 0,
				lastPoster: "匿名",
				anonymousAuthor: 1,
				anonymousLastPoster: 1,
			});
			expect(open.authorId).toBe(10);
			expect(open.authorName).toBe("Renamed");
			const profileCalls = f.calls.filter((call) => call.sql.includes("FROM users"));
			expect(profileCalls.every((call) => !call.params.includes(20))).toBe(true);
			expect(f.env.KV.get).not.toHaveBeenCalled();
		}
	});

	it("hides a public child of a restricted parent and its global announcement", async () => {
		open();
		f.insert("forums", { id: 21, parent_id: 2, name: "Public child", visibility: "public" });
		f.thread(8, { subject: "Local", last_post_at: 10 });
		f.thread(100, {
			forum_id: 21,
			sticky: 2,
			subject: "Hidden pin",
			last_post_at: 5000,
		});
		const anon = await forumListContext(post(request({ includeDisplay: true })), f.env);
		const anonBody = await anon.json();
		expect(anonBody.data.display.threads.map((row: { id: number }) => row.id)).toEqual([8]);
		expect(anonBody.data.display.forums.map((row: { id: number }) => row.id)).not.toContain(21);
		expect((await forumListContext(post(request({ forumId: 21 })), f.env)).status).toBe(403);

		const jwt = await createJwtForRole(3, 30, f.env.JWT_SECRET);
		const staffChild = await forumListContext(
			post(request({ forumId: 21, includeDisplay: true }), { authorization: `Bearer ${jwt}` }),
			f.env,
		);
		expect(staffChild.status).toBe(200);
		const child = await staffChild.json();
		expect(child.data.bucket).toBe("staff");
		expect(child.data.display.forums.map((row: { id: number }) => row.id).sort()).toEqual([2, 21]);

		const staffList = await forumListContext(
			post(request({ includeDisplay: true }), { authorization: `Bearer ${jwt}` }),
			f.env,
		);
		const staffBody = await staffList.json();
		expect(staffBody.data.display.threads.map((row: { id: number }) => row.id)).toContain(100);
	});

	it("uses the D1 role after demotion and rejects a bad token without an anonymous fallback", async () => {
		open();
		const jwt = await createJwtForRole(1, 1, f.env.JWT_SECRET);
		const before = await forumListContext(
			post(request({ forumId: 2 }), { authorization: `Bearer ${jwt}` }),
			f.env,
		);
		expect(before.status).toBe(200);
		expect((await before.json()).data.bucket).toBe("admin");
		f.sqlite.exec("UPDATE users SET role = 0 WHERE id = 1");
		const demoted = await forumListContext(
			post(request({ forumId: 1 }), { authorization: `Bearer ${jwt}` }),
			f.env,
		);
		const demotedBody = await demoted.json();
		expect(demotedBody.data.bucket).toBe("member");
		expect(demotedBody.data.user.role).toBe(0);
		expect(
			(
				await forumListContext(
					post(request({ forumId: 2 }), { authorization: `Bearer ${jwt}` }),
					f.env,
				)
			).status,
		).toBe(403);
		const rejected = await forumListContext(
			post(request(), { authorization: "Bearer not-a-token" }),
			f.env,
		);
		expect(rejected.status).toBe(401);
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});

	it("normalizes invalid type filters and does not merge announcements into a typed page", async () => {
		open();
		f.sqlite.exec(
			"UPDATE forums SET thread_types_enabled = 1, thread_types_listable = 1, thread_types_prefix = 1 WHERE id = 1",
		);
		f.insert("forum_thread_types", {
			id: 7,
			forum_id: 1,
			name: "News",
			display_order: 1,
			enabled: 1,
			source_typeid: 1,
		});
		f.insert("forum_thread_types", {
			id: 9,
			forum_id: 1,
			name: "Old",
			display_order: 2,
			enabled: 0,
			source_typeid: 2,
		});
		f.insert("forum_thread_types", {
			id: 70,
			forum_id: 2,
			name: "Elsewhere",
			display_order: 1,
			enabled: 1,
			source_typeid: 1,
		});
		f.thread(8, { type_id: 7, type_name: "News", subject: "Typed", last_post_at: 10 });
		f.thread(100, { sticky: 2, subject: "Global", last_post_at: 50 });
		const typed = await (
			await forumListContext(post(request({ typeId: 7, includeCount: true })), f.env)
		).json();
		expect(typed.data.typeId).toBe(7);
		expect(typed.data.display.threads.map((row: { id: number }) => row.id)).toEqual([8]);
		expect(typed.data.count).toBe(1);
		f.thread(101, { sticky: 2, type_id: 7, last_post_at: 60 });
		const typedGlobal = await (
			await forumListContext(post(request({ typeId: 7, includeCount: true })), f.env)
		).json();
		expect(typedGlobal.data.display.threads.map((row: { id: number }) => row.id)).toEqual([101, 8]);
		expect(typedGlobal.data.count).toBe(2);

		const cold = await (
			await forumListContext(post(request({ includeCount: true })), f.env)
		).json();
		const normalized = await forumListContext(
			post(
				request({
					typeId: 999,
					cachedRevision: cold.data.revision,
					includeDisplay: false,
					includeCount: false,
				}),
			),
			f.env,
		);
		const body = await normalized.json();
		expect(body.data.typeId).toBeNull();
		expect(body.data.count).toBe(cold.data.count);
		expect(body.data.display).toBeDefined();
		expect(
			(await (await forumListContext(post(request({ typeId: 9 })), f.env)).json()).data.typeId,
		).toBe(null);
		expect(
			(await (await forumListContext(post(request({ typeId: 70 })), f.env)).json()).data.typeId,
		).toBe(null);
		f.sqlite.exec("UPDATE forums SET thread_types_listable = 0 WHERE id = 1");
		expect(
			(await (await forumListContext(post(request({ typeId: 7 })), f.env)).json()).data.typeId,
		).toBe(null);
	});

	it("returns the requested empty offset and an exact hasNext", async () => {
		open();
		f.thread(1, { last_post_at: 30 });
		f.thread(2, { last_post_at: 20 });
		f.thread(3, { last_post_at: 10 });
		const first = await (
			await forumListContext(
				post(request({ limit: 2, includeDisplay: true, includeCount: true })),
				f.env,
			)
		).json();
		expect(first.data.display.threads.map((row: { id: number }) => row.id)).toEqual([1, 2]);
		expect(first.data.hasNext).toBe(true);
		const second = await (
			await forumListContext(post(request({ page: 2, limit: 2, includeDisplay: true })), f.env)
		).json();
		expect(second.data.page).toBe(2);
		expect(second.data.display.threads.map((row: { id: number }) => row.id)).toEqual([3]);
		expect(second.data.hasNext).toBe(false);
		const empty = await (
			await forumListContext(
				post(request({ page: 9, limit: 2, includeDisplay: true, includeCount: true })),
				f.env,
			)
		).json();
		expect(empty.data.page).toBe(9);
		expect(empty.data.display.threads).toEqual([]);
		expect(empty.data.hasNext).toBe(false);
		expect(empty.data.count).toBe(3);
	});

	it.each([false, true])(
		"bounds membership retries during concurrent deletion: %s",
		async (keepChanging) => {
			open();
			for (let id = 1; id <= 5; id++) f.thread(id, { last_post_at: 100 - id });
			let membershipReads = 0;
			f.state.afterRead = async (sql) => {
				if (!sql.includes("FROM threads t\n\t\t\tWHERE") || !sql.includes("OFFSET")) return;
				membershipReads++;
				if (membershipReads === 1 || keepChanging) {
					f.sqlite.prepare("DELETE FROM threads WHERE id = ?").run(membershipReads);
				}
			};
			const response = await forumListContext(
				post(request({ limit: 2, includeCount: true })),
				f.env,
			);
			expect(membershipReads).toBe(2);
			if (keepChanging) {
				expect(response.status).toBe(503);
				return;
			}
			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.display.threads.map((row: { id: number }) => row.id)).toEqual([2, 3]);
			expect(body.data.hasNext).toBe(true);
			expect(body.data.count).toBe(4);
		},
	);

	it("skips topic and recommendation reads on a group and still returns visible children", async () => {
		open();
		f.insert("forums", { id: 40, name: "Group", type: "group", visibility: "public" });
		f.insert("forums", {
			id: 41,
			parent_id: 40,
			name: "Child",
			type: "forum",
			visibility: "public",
		});
		f.thread(8, { forum_id: 40, subject: "Should not load" });
		f.insert("forum_recommended_threads", {
			forum_id: 40,
			thread_id: 8,
			recommended_at: 5,
			recommended_by: 30,
		});
		const response = await forumListContext(
			post(request({ forumId: 40, includeDisplay: true, includeCount: true })),
			f.env,
		);
		const body = await response.json();
		expect(body.data.display.forums.map((row: { id: number }) => row.id).sort()).toEqual([40, 41]);
		expect(body.data.display.threads).toEqual([]);
		expect(body.data.display.recommended).toEqual([]);
		expect(body.data.hasNext).toBe(false);
		expect(body.data.count).toBe(0);
		const sql = f.calls.map((call) => call.sql).join("\n");
		expect(sql).not.toContain("forum_recommended_threads");
		expect(sql).not.toContain("t.sticky");
	});

	it("rejects overflow instead of returning a truncated page", async () => {
		open();
		const insert = f.sqlite.prepare(
			"INSERT INTO forums (id, name, visibility) VALUES (?, ?, 'public')",
		);
		for (let id = 100; id < 100 + 2046; id++) insert.run(id, `F${id}`);
		const forums = await forumListContext(post(request()), f.env);
		const forumBody = await forums.json();
		expect(forums.status).toBe(503);
		expect(forumBody.error.code).toBe("SERVICE_UNAVAILABLE");
		expect(forumBody.data).toBeUndefined();

		f.close();
		open();
		for (let id = 1; id <= 513; id++) f.thread(id, { sticky: 2, last_post_at: id });
		const announcements = await forumListContext(post(request({ includeDisplay: true })), f.env);
		const announcementBody = await announcements.json();
		expect(announcements.status).toBe(503);
		expect(announcementBody.data).toBeUndefined();

		f.close();
		open();
		f.thread(8, { subject: "Kept" });
		f.sqlite.exec(`UPDATE forums SET description = '${"a".repeat(2 * 1024 * 1024)}' WHERE id = 1`);
		const oversized = await forumListContext(post(request({ includeDisplay: true })), f.env);
		expect(oversized.status).toBe(503);
		const error = await oversized.json();
		expect(error.data).toBeUndefined();
		expect(error.error.details.message).toContain("response bound");
	});

	it("omits failed stats without writing a zero default", async () => {
		open();
		f.thread(8, { subject: "Still here" });
		f.state.afterRead = async (sql) => {
			if (sql.includes("FROM settings")) throw new Error("stats read failed");
		};
		const response = await forumListContext(
			post(request({ includeDisplay: true, includeStats: true })),
			f.env,
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.data.stats).toBeUndefined();
		expect(body.data.display.threads[0].subject).toBe("Still here");
		expect(f.env.KV.put).not.toHaveBeenCalled();
		f.state.afterRead = undefined;
		const recovered = await (
			await forumListContext(post(request({ includeStats: true })), f.env)
		).json();
		expect(recovered.data.stats.totalThreads).toEqual(expect.any(Number));
	});

	it("forces display and count when the bucket hint does not match", async () => {
		open();
		f.thread(8, { subject: "Shown" });
		const response = await forumListContext(
			post(request({ cachedBucket: "member", includeDisplay: false, includeCount: false })),
			f.env,
		);
		const body = await response.json();
		expect(body.data.bucket).toBe("anon");
		expect(body.data.display.threads[0].subject).toBe("Shown");
		expect(body.data.count).toBe(1);
	});

	it("forces only display when only the cached revision changes", async () => {
		open();
		f.thread(8, { subject: "Shown" });
		const mismatch = await forumListContext(
			post(
				request({
					cachedRevision: "a".repeat(64),
					includeDisplay: false,
					includeCount: false,
				}),
			),
			f.env,
		);
		const again = await mismatch.json();
		expect(again.data.display.threads).toHaveLength(1);
		expect(again.data.count).toBeUndefined();
		expect(f.env.KV.get).not.toHaveBeenCalled();
		const sql = f.calls.map((call) => call.sql).join("\n");
		expect(sql).not.toMatch(/COUNT\(\*\) AS total FROM threads/);
	});

	it("rejects malformed transport before reading authority", async () => {
		open();
		expect((await forumListContext(post(request(), {}), f.env)).status).toBe(200);
		const queried = new Request("https://api.example.com/api/v1/forums/context?page=2", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request()),
		});
		expect((await forumListContext(queried, f.env)).status).toBe(400);
		expect((await forumListContext(post("{"), f.env)).status).toBe(400);
		expect((await forumListContext(post({ ...request(), extra: 1 }), f.env)).status).toBe(400);
		expect((await forumListContext(post(request({ forumId: 99 })), f.env)).status).toBe(404);
		expect(f.calls.some((call) => call.mode === "run")).toBe(false);
	});

	it.each([
		["Basic invalid", "INVALID_TOKEN"],
		["Bearer", "INVALID_TOKEN"],
		["expired", "TOKEN_EXPIRED"],
		["invalid-user", "INVALID_TOKEN"],
	])("rejects %s credentials before reading D1", async (credential, code) => {
		open();
		let authorization = credential;
		if (credential === "expired" || credential === "invalid-user") {
			const token = await createJwt(
				{
					userId: credential === "invalid-user" ? 0 : 10,
					role: 0,
					exp: Math.floor(Date.now() / 1000) + (credential === "expired" ? -60 : 60),
				},
				f.env.JWT_SECRET,
			);
			authorization = `Bearer ${token}`;
		}
		const response = await forumListContext(post(request(), { authorization }), f.env);
		expect(response.status).toBe(401);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect((await response.json()).error.code).toBe(code);
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});

	it.each([
		["{}", { "content-type": "text/plain" }],
		["{}", { "content-length": "invalid" }],
		["{}", { "content-length": "4097" }],
		["x".repeat(4097), {}],
	] as const)("rejects invalid or oversized transport before D1: %j", async (body, headers) => {
		open();
		const response = await forumListContext(post(body, headers), f.env);
		expect(response.status).toBe(400);
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect((await response.json()).error.code).toBe("INVALID_REQUEST");
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
	});

	it("shares one revision between members in the same bucket", async () => {
		open();
		f.thread(8);
		const alice = await createJwtForRole(0, 10, f.env.JWT_SECRET);
		const bob = await createJwtForRole(0, 20, f.env.JWT_SECRET);
		const first = await (
			await forumListContext(post(request(), { authorization: `Bearer ${alice}` }), f.env)
		).json();
		const second = await (
			await forumListContext(post(request(), { authorization: `Bearer ${bob}` }), f.env)
		).json();
		expect(first.data.bucket).toBe("member");
		expect(second.data.revision).toBe(first.data.revision);
	});

	it("does not encode masked identities in a list or recommendation revision", async () => {
		open();
		f.thread(8, {
			anonymous_author: 1,
			anonymous_last_poster: 1,
			author_id: 10,
			last_poster_id: 10,
		});
		f.insert("forum_recommended_threads", {
			forum_id: 1,
			thread_id: 8,
			recommended_at: 1,
			recommended_by: 30,
		});
		const first = await (await forumListContext(post(request()), f.env)).json();
		f.sqlite.exec("UPDATE threads SET author_id = 20, last_poster_id = 20 WHERE id = 8");
		const second = await (
			await forumListContext(post(request({ cachedRevision: first.data.revision })), f.env)
		).json();
		expect(second.data.revision).toBe(first.data.revision);
		expect(second.data.display).toBeUndefined();
	});

	it("bounds category reads before materializing and rejects overflow", async () => {
		open();
		const insert = f.sqlite.prepare(
			"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, enabled) VALUES (?, 1, ?, 'Type', 1)",
		);
		for (let id = 1; id <= 257; id++) insert.run(id, id);
		expect((await forumListContext(post(request()), f.env)).status).toBe(503);
		const query = f.calls.find((call) => call.sql.includes("FROM forum_thread_types"));
		expect(query?.sql).toContain("LIMIT ?");
		expect(query?.params).toEqual([1, 257]);
	});

	it("bounds moderator text and the aggregate profile workload", async () => {
		open();
		f.sqlite.prepare("UPDATE forums SET moderator_ids = ? WHERE id = 1").run("1,".repeat(1025));
		expect((await forumListContext(post(request()), f.env)).status).toBe(503);
		f.sqlite
			.prepare("UPDATE forums SET moderator_ids = ? WHERE id = 1")
			.run(Array.from({ length: 257 }, (_, i) => i + 100).join(","));
		expect((await forumListContext(post(request()), f.env)).status).toBe(503);
		expect(
			f.calls.some((call) => call.sql.includes("SELECT id, username FROM users WHERE id IN")),
		).toBe(false);
	});

	it("projects recommended cards as anonymous for every viewer and caps the card at six", async () => {
		open();
		f.thread(20, { subject: "Secret card", anonymous_author: 1, author_id: 10, replies: 4 });
		f.insert("forum_recommended_threads", {
			forum_id: 1,
			thread_id: 20,
			recommended_at: 40,
			recommended_by: 30,
		});
		for (let id = 11; id <= 15; id++) {
			f.thread(id, { subject: `Card ${id}` });
			f.insert("forum_recommended_threads", {
				forum_id: 1,
				thread_id: id,
				recommended_at: id,
				recommended_by: 30,
			});
		}
		const jwt = await createJwtForRole(1, 1, f.env.JWT_SECRET);
		const body = await (
			await forumListContext(
				post(request({ includeDisplay: true }), { authorization: `Bearer ${jwt}` }),
				f.env,
			)
		).json();
		expect(body.data.display.recommended).toHaveLength(6);
		expect(body.data.display.recommended[0]).toMatchObject({
			id: 20,
			authorId: 0,
			authorName: "匿名",
			replies: 4,
			recommendedAt: 40,
		});
		expect(body.data.display.recommended.some((row: { id: number }) => row.id === 11)).toBe(true);
	});
});
