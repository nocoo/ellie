import { afterEach, describe, expect, it } from "vitest";
import { homeContext } from "../../../src/handlers/home";
import {
	loadHomeAuthority,
	loadHomeDisplay,
	loadHomeGates,
	selectAllowedForumIds,
} from "../../../src/lib/home-read";
import { createJwt } from "../../../src/lib/jwt";
import { createJwtForRole } from "../../helpers";
import { deferred, readingFixture } from "../lib/cache/thread-cache-fixture";

function post(
	body: unknown,
	headers?: Record<string, string>,
	path = "/api/v1/home/context",
): Request {
	return new Request(`https://api.example.com${path}`, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

const warm = {
	cachedBucket: "anon",
	includeDisplay: false,
	includeStats: false,
	summaryTopicIds: [] as number[],
	digestTopicIds: [] as number[],
};

describe("POST /api/v1/home/context", () => {
	let f: ReturnType<typeof readingFixture>;

	afterEach(() => {
		f?.close();
	});

	function open() {
		f = readingFixture();
		return f;
	}

	it("returns no-store anon authority without display, stats, KV, or writes", async () => {
		open();
		f.thread(8, { subject: "Visible", digest: 2, last_post_at: 80 });
		const response = await homeContext(post(warm), f.env);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toContain("no-store");
		const body = await response.json();
		expect(body.data.bucket).toBe("anon");
		expect(body.data.user).toBeNull();
		expect(body.data.allowedForumIds).toEqual([1]);
		expect(body.data.display).toBeUndefined();
		expect(body.data.stats).toBeUndefined();
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.calls.some((call) => call.mode === "run")).toBe(false);
		expect(f.calls.some((call) => call.sql.includes("idx_threads_digest"))).toBe(false);
		const forumSql = f.calls.filter((call) => call.sql.includes("FROM forums"));
		expect(forumSql.length).toBeGreaterThan(0);
		expect(forumSql.every((call) => !/name|description|moderator_ids/.test(call.sql))).toBe(true);
	});

	it("rebuilds current author names after rename and keeps hot gates free of display text", async () => {
		open();
		f.thread(8, { digest: 2, author_name: "Old name" });
		await f.env.DB.prepare("UPDATE users SET username = ? WHERE id = ?").bind("Renamed", 10).run();
		const cold = await homeContext(post({ ...warm, includeDisplay: true }), f.env);
		const body = await cold.json();
		expect(body.data.display.digest[0].authorName).toBe("Renamed");
		f.calls.length = 0;
		await homeContext(post({ ...warm, summaryTopicIds: [8], digestTopicIds: [8] }), f.env);
		const queries = f.calls.map((call) => call.sql).join("\n");
		expect(queries).not.toContain("t.subject");
		expect(queries).not.toContain("t.author_name");
		expect(queries).not.toContain("JOIN users");
	});

	it("joins fast stats failures only after delayed authority completes", async () => {
		open();
		const authority = deferred();
		let statsStarted = false;
		f.state.afterRead = async (sql) => {
			if (sql === "SELECT id, parent_id, status, visibility FROM forums") await authority.promise;
			if (sql.includes("SELECT key, value FROM settings")) {
				statsStarted = true;
				throw new Error("stats read failed");
			}
		};
		const failure = expect(
			homeContext(post({ ...warm, includeStats: true }), f.env),
		).rejects.toThrow("stats read failed");
		await new Promise<void>((resolve) => setImmediate(resolve));
		expect(statsStarted).toBe(false);
		authority.resolve();
		await failure;
		expect(statsStarted).toBe(true);
	});

	it("forces a fresh display when the cached bucket does not match", async () => {
		open();
		f.thread(8, { subject: "Featured", digest: 3, last_post_at: 90, replies: 4, views: 6 });
		const response = await homeContext(
			post({ ...warm, cachedBucket: "member", summaryTopicIds: [] }),
			f.env,
		);
		const body = await response.json();
		expect(body.data.bucket).toBe("anon");
		expect(body.data.display.digest).toEqual([
			expect.objectContaining({
				id: 8,
				forumId: 1,
				subject: "Featured",
				digest: 3,
				replies: 4,
				views: 6,
				authorId: 10,
				authorName: "alice",
				anonymousAuthor: 0,
			}),
		]);
		expect(body.data.digestGates).toEqual([
			expect.objectContaining({ topicId: 8, forumId: 1, digest: 3, authorId: 10 }),
		]);
		expect(body.data.display.forums.map((forum: { id: number }) => forum.id)).toEqual([1]);
		expect(body.data.stats).toBeUndefined();
	});

	it("masks anonymous digest authors for the owner and for staff", async () => {
		open();
		f.thread(9, {
			subject: "Secret",
			digest: 2,
			last_post_at: 100,
			anonymous_author: 1,
			author_id: 10,
			author_name: "alice",
		});
		const owner = await createJwtForRole(0, 10, f.env.JWT_SECRET);
		const staff = await createJwtForRole(1, 1, f.env.JWT_SECRET);
		for (const token of [owner, staff]) {
			const response = await homeContext(
				post(
					{ ...warm, cachedBucket: null, includeDisplay: true, digestTopicIds: [9] },
					{ authorization: `Bearer ${token}` },
				),
				f.env,
			);
			const body = await response.json();
			expect(body.data.digestGates).toEqual([
				expect.objectContaining({ topicId: 9, anonymousAuthor: 1, authorId: 0 }),
			]);
			expect(body.data.display.digest[0]).toMatchObject({
				authorId: 0,
				authorName: "匿名",
				anonymousAuthor: 1,
			});
			expect(JSON.stringify(body.data.display.digest)).not.toContain("alice");
			expect(JSON.stringify(body.data.digestGates)).not.toContain("alice");
		}
	});

	it("drops hidden ancestors, pending topics, and uses the database role", async () => {
		open();
		f.insert("forums", { id: 40, name: "Hidden parent", status: 0, visibility: "public" });
		f.insert("forums", { id: 41, name: "Child", parent_id: 40, visibility: "public" });
		f.insert("forums", { id: 42, name: "Admin only", visibility: "admin" });
		f.thread(11, { forum_id: 41, digest: 3, last_post_at: 200, subject: "Hidden child" });
		f.thread(12, { sticky: -2, digest: 3, last_post_at: 300, subject: "Pending" });
		f.thread(13, { forum_id: 1, subject: "Latest", created_at: 50 });
		const lied = await createJwtForRole(1, 10, f.env.JWT_SECRET);
		const response = await homeContext(
			post(
				{
					...warm,
					cachedBucket: "admin",
					includeDisplay: false,
					summaryTopicIds: [13, 12],
					digestTopicIds: [11, 12],
				},
				{ authorization: `Bearer ${lied}` },
			),
			f.env,
		);
		const body = await response.json();
		expect(body.data.bucket).toBe("member");
		expect(body.data.user).toMatchObject({ id: 10, role: 0, username: "alice" });
		expect(body.data.user).not.toHaveProperty("password_hash");
		expect(body.data.allowedForumIds).not.toContain(40);
		expect(body.data.allowedForumIds).not.toContain(41);
		expect(body.data.allowedForumIds).not.toContain(42);
		expect(body.data.display).toBeDefined();
		expect(body.data.display.forums.map((forum: { id: number }) => forum.id)).not.toContain(41);
		expect(body.data.summaryGates.map((gate: { topicId: number }) => gate.topicId)).not.toContain(
			12,
		);
		expect(body.data.digestGates.map((gate: { topicId: number }) => gate.topicId)).toEqual([]);
		expect(JSON.stringify(body.data.display)).not.toContain("Hidden child");
		expect(JSON.stringify(body.data.display)).not.toContain("Pending");
	});

	it("rejects application/jsonx and accepts a charset parameter", async () => {
		open();
		const rejected = await homeContext(post(warm, { "content-type": "application/jsonx" }), f.env);
		expect(rejected.status).toBe(400);
		expect((await rejected.json()).error.details.message).toBe("Invalid content type");

		const accepted = await homeContext(
			post(warm, { "content-type": "application/json; charset=utf-8" }),
			f.env,
		);
		expect(accepted.status).toBe(200);
	});

	it("ranks five allowed digests in one json_each query", async () => {
		open();
		f.insert("forums", { id: 40, name: "Hidden parent", status: 0, visibility: "public" });
		f.insert("forums", { id: 41, name: "Hidden child", parent_id: 40, visibility: "public" });
		f.thread(201, { forum_id: 2, digest: 3, last_post_at: 900, subject: "Staff only" });
		f.thread(202, { forum_id: 41, digest: 3, last_post_at: 950, subject: "Hidden child" });
		f.thread(203, { digest: 3, last_post_at: 800, sticky: -2, subject: "Pending" });
		f.thread(204, { digest: 3, last_post_at: 700, subject: "Third" });
		f.thread(205, { digest: 3, last_post_at: 700, subject: "Tie newer id" });
		f.thread(206, { digest: 2, last_post_at: 600, subject: "Second" });
		f.thread(207, { digest: 1, last_post_at: 500, subject: "First low" });
		f.thread(208, { digest: 1, last_post_at: 400, subject: "Dropped sixth" });
		f.thread(209, { digest: 3, last_post_at: 1000, subject: "Top" });
		const response = await homeContext(
			post({ ...warm, cachedBucket: null, includeDisplay: true }),
			f.env,
		);
		const body = await response.json();
		expect(body.data.display.digest.map((row: { id: number }) => row.id)).toEqual([
			209, 205, 204, 206, 207,
		]);
		const digestSql = f.calls.filter((call) => call.sql.includes("idx_threads_digest"));
		expect(digestSql).toHaveLength(1);
		expect(digestSql[0]?.sql).toContain("json_each(?)");
		expect(digestSql[0]?.params[0]).toBe(JSON.stringify([1]));
		expect(digestSql[0]?.params[1]).toBe(5);
	});

	it("rejects an incorrect JWT and does not read the user row", async () => {
		open();
		const response = await homeContext(post(warm, { authorization: "Bearer not-a-jwt" }), f.env);
		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error.code).toBe("INVALID_TOKEN");
		expect(f.calls.some((call) => call.sql.includes("FROM users"))).toBe(false);
	});

	it("rejects an expired JWT", async () => {
		open();
		const token = await createJwt(
			{ userId: 10, role: 0, exp: Math.floor(Date.now() / 1000) - 10 },
			f.env.JWT_SECRET,
		);
		const response = await homeContext(post(warm, { authorization: `Bearer ${token}` }), f.env);
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe("TOKEN_EXPIRED");
	});

	it("rejects overflow, duplicates, unknown fields, and bodies over 32 KiB", async () => {
		open();
		const overflow = await homeContext(
			post({ ...warm, summaryTopicIds: Array.from({ length: 513 }, (_, index) => index + 1) }),
			f.env,
		);
		expect(overflow.status).toBe(400);
		expect((await overflow.json()).error.details.message).toBe("Too many topic ids");

		const duplicate = await homeContext(post({ ...warm, digestTopicIds: [1, 1] }), f.env);
		expect(duplicate.status).toBe(400);

		const identity = await homeContext(post({ ...warm, role: 1 }), f.env);
		expect(identity.status).toBe(400);

		const huge = await homeContext(post("{}", { "content-length": "32769" }), f.env);
		expect(huge.status).toBe(400);
		expect((await huge.json()).error.details.message).toBe("Request body too large");
		expect(f.calls).toEqual([]);
	});

	it("returns stats only when requested and keeps them out of the display", async () => {
		open();
		const response = await homeContext(
			post({ ...warm, cachedBucket: null, includeDisplay: true, includeStats: true }),
			f.env,
		);
		const body = await response.json();
		expect(body.data.stats).toMatchObject({
			todayPosts: 0,
			totalThreads: expect.any(Number),
			totalOnline: 0,
		});
		expect(body.data.display).not.toHaveProperty("stats");
		expect(body.data.display).not.toHaveProperty("user");
	});
	it("rejects malformed transport before reading D1, including actual oversized streams", async () => {
		open();
		for (const request of [
			post(warm, undefined, "/api/v1/home/context?userId=1"),
			post("{"),
			post(" ".repeat(32769)),
			new Request("https://api.example.com/api/v1/home/context", {
				method: "POST",
				headers: { "content-type": "application/json" },
			}),
		])
			expect((await homeContext(request, f.env)).status).toBe(400);
		expect((await homeContext(post(warm, { authorization: "Basic invalid" }), f.env)).status).toBe(
			401,
		);
		expect(f.calls).toEqual([]);
	});

	it("does not trust a signed role for missing or disabled users", async () => {
		open();
		f.sqlite.prepare("UPDATE users SET status = 1 WHERE id = 10").run();
		for (const id of [10, 999999]) {
			const jwt = await createJwtForRole(1, id, f.env.JWT_SECRET);
			const response = await homeContext(post(warm, { authorization: `Bearer ${jwt}` }), f.env);
			expect((await response.json()).data).toMatchObject({ bucket: "anon", user: null });
		}
	});

	it("fails closed for missing ancestors and cyclic parent chains", () => {
		open();
		const row = { status: 1, visibility: "public" as const };
		expect(
			selectAllowedForumIds(
				[
					{ ...row, id: 1, parent_id: 99 },
					{ ...row, id: 2, parent_id: 3 },
					{ ...row, id: 3, parent_id: 2 },
				],
				"anon",
			),
		).toEqual([]);
	});

	it("returns all 513 fresh summary candidates using bounded SQL batches", async () => {
		open();
		for (let id = 100; id < 613; id++) {
			f.insert("forums", { id, name: `Forum ${id}`, visibility: "public", moderator_ids: "10,20" });
			f.thread(id + 1000, { forum_id: id, digest: id < 105 ? 1 : 0 });
		}
		const response = await homeContext(post({ ...warm, includeDisplay: true }), f.env);
		const body = await response.json();
		expect(
			body.data.display.summaries.filter((row: { topicId: number }) => row.topicId > 0),
		).toHaveLength(513);
		expect(body.data.summaryGates).toHaveLength(513);
		expect(
			body.data.display.forums.find((row: { id: number }) => row.id === 100).moderatorList,
		).toHaveLength(2);
		expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
		const hot = await homeContext(
			post({ ...warm, summaryTopicIds: [1100, 1101], digestTopicIds: [1100, 1101] }),
			f.env,
		);
		expect((await hot.json()).data.digestGates).toHaveLength(2);
	});

	it("clears a summary selected before a concurrent moderation hide", async () => {
		open();
		f.thread(8, { subject: "Must disappear" });
		f.state.afterRead = async (sql) => {
			if (sql.startsWith("SELECT f.id, f.status"))
				f.sqlite.prepare("UPDATE threads SET sticky = -1 WHERE id = 8").run();
		};
		const response = await homeContext(post({ ...warm, includeDisplay: true }), f.env);
		const body = await response.json();
		expect(body.data.display.summaries[0]).toMatchObject({
			topicId: 0,
			topicSubject: "",
			authorId: 0,
		});
		expect(JSON.stringify(body.data.display)).not.toContain("Must disappear");
	});

	it("propagates D1 read failures instead of caching empty authority or display", async () => {
		open();
		const authority = await loadHomeAuthority(f.env, null);
		f.state.queryError = true;
		await expect(loadHomeAuthority(f.env, null)).rejects.toThrow("Home forums");
		await expect(loadHomeGates(f.env, authority, [1], [])).rejects.toThrow("Home topic gates");
		await expect(loadHomeDisplay(f.env, authority, [], [])).rejects.toThrow("Home forum text");
	});
});
