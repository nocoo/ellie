import "./_helpers/setup";

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { statsReportsGenKey, threadMetaGenKey } from "../../../apps/worker/src/lib/cache/keys";
import { createJwt } from "../../../apps/worker/src/lib/jwt";
import {
	shanghaiDateLocal,
	shanghaiTodayStartUnix,
} from "../../../apps/worker/src/lib/shanghaiTime";
import { createTestEnv, flushCurrentTestCtx, type TestEnv, workerFetch } from "./_helpers/env";

let env: TestEnv;
const initialCounters = {
	"stats.total_threads": "90",
	"stats.total_posts": "450",
	"stats.total_members": "45",
	"stats.yesterday_posts": "20",
};

beforeEach(() => {
	setSystemTime(new Date("2026-09-17T04:00:00Z"));
	env = createTestEnv();
	const db = env._sqlite;
	db.exec("PRAGMA foreign_keys = ON");
	db.query(
		"INSERT INTO users (id, username, role, status, email_verified_at) VALUES (10, 'author', 0, 0, 1), (20, 'reader', 0, 0, 1), (30, 'moderator', 3, 0, 1), (40, 'banned', 0, -1, 0)",
	).run();
	db.query(
		"INSERT INTO forums (id, name, moderators, visibility) VALUES (7, 'Public', 'moderator', 'public'), (8, 'Private', '', 'admin')",
	).run();
	db.query(
		"INSERT INTO threads (id, forum_id, author_id, author_name, subject) VALUES (1, 7, 10, 'author', 'Original subject'), (2, 8, 40, 'banned', 'Private subject')",
	).run();
	const start = shanghaiTodayStartUnix();
	const post = db.query(
		"INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, is_first, position, created_at, invisible) VALUES (?, ?, ?, ?, ?, 'Original post content', ?, ?, ?, ?)",
	);
	post.run(1, 1, 7, 10, "author", 1, 1, start, 0);
	post.run(2, 1, 7, 20, "reader", 0, 2, start + 86399, 1);
	post.run(3, 2, 8, 40, "banned", 1, 1, start - 1, 1);
	post.run(4, 1, 7, 20, "reader", 0, 3, start + 86400, 0);
	for (const [key, value] of Object.entries(initialCounters)) {
		db.query("UPDATE settings SET value = ?, updated_at = 1 WHERE key = ?").run(value, key);
	}
	db.query(
		"INSERT INTO settings (key, value, type) VALUES ('routing.marker', 'unchanged', 'string')",
	).run();
});

afterEach(async () => {
	await flushCurrentTestCtx();
	env._sqlite.close();
	setSystemTime();
});

async function userHeaders(userId = 10, role = 0) {
	const token = await createJwt(
		{ userId, role, exp: Math.floor(Date.now() / 1000) + 3600 },
		env.JWT_SECRET,
	);
	return {
		"X-API-Key": env.API_KEY,
		"Content-Type": "application/json",
		Authorization: `Bearer ${token}`,
	};
}

function counters() {
	return Object.fromEntries(
		env._sqlite
			.query<{ key: string; value: string }, []>(
				"SELECT key, value FROM settings WHERE key LIKE 'stats.%' ORDER BY key",
			)
			.all()
			.map((row) => [row.key, row.value]),
	);
}

function subject() {
	return env._sqlite.query("SELECT subject FROM threads WHERE id = 1").get();
}

describe("L2-fast: PATCH thread subject routing", () => {
	test.each([undefined, "wrong-key", "test-admin-api-key"])(
		"requires Key A even with a valid user token (key=%s)",
		async (key) => {
			const headers = new Headers(await userHeaders());
			if (key) headers.set("X-API-Key", key);
			else headers.delete("X-API-Key");
			const response = await workerFetch(env, "/api/v1/threads/1", {
				method: "PATCH",
				headers,
				body: JSON.stringify({ subject: "Denied" }),
			});
			expect(response.status).toBe(401);
			expect((await response.json()).error.code).toBe("UNAUTHORIZED");
			expect(subject()).toEqual({ subject: "Original subject" });
			expect(await env.KV.get(threadMetaGenKey(1))).toBeNull();
		},
	);

	test.each([undefined, "Bearer invalid-token"])("requires a valid JWT (%s)", async (auth) => {
		const headers = new Headers({ "X-API-Key": env.API_KEY, "Content-Type": "application/json" });
		if (auth) headers.set("Authorization", auth);
		const response = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "Denied" }),
		});
		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe(auth ? "INVALID_TOKEN" : "UNAUTHORIZED");
		expect(subject()).toEqual({ subject: "Original subject" });
	});

	test("edits an author title after censoring and refreshes a warm thread read; a no-op keeps the generation", async () => {
		const warm = await workerFetch(env, "/api/v1/threads/1", {
			method: "GET",
			headers: { "X-API-Key": env.API_KEY },
		});
		expect(warm.status).toBe(200);
		expect((await warm.json()).data.subject).toBe("Original subject");
		await flushCurrentTestCtx();
		env._sqlite
			.query(
				"INSERT INTO censor_words (id, find, replacement, action, admin_id, created_at) VALUES (1, 'draft', 'published', 'replace', 30, 1)",
			)
			.run();
		const headers = await userHeaders();
		const edited = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "  New draft subject  " }),
		});
		expect(edited.status).toBe(200);
		expect((await edited.json()).data).toEqual({ id: 1, updated: true });
		expect(subject()).toEqual({ subject: "New published subject" });
		expect(env._sqlite.query("SELECT content FROM posts WHERE id = 1").get()).toEqual({
			content: "Original post content",
		});
		const generation = await env.KV.get(threadMetaGenKey(1));
		expect(generation).not.toBeNull();
		const fresh = await workerFetch(env, "/api/v1/threads/1", {
			method: "GET",
			headers: { "X-API-Key": env.API_KEY },
		});
		expect((await fresh.json()).data.subject).toBe("New published subject");
		const noOp = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "  New published subject  " }),
		});
		expect(noOp.status).toBe(200);
		expect((await noOp.json()).data).toEqual({ id: 1, updated: false });
		expect(await env.KV.get(threadMetaGenKey(1))).toBe(generation);
		expect(env._sqlite.query("SELECT action FROM admin_logs").all()).toEqual([]);
	});

	test("checks current email verification and ban state after the same author token succeeded", async () => {
		const headers = await userHeaders();
		const edited = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "Verified edit" }),
		});
		expect(edited.status).toBe(200);
		const generation = await env.KV.get(threadMetaGenKey(1));
		env._sqlite.query("UPDATE users SET email_verified_at = 0 WHERE id = 10").run();
		const unverified = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "Denied" }),
		});
		expect(unverified.status).toBe(403);
		expect((await unverified.json()).error).toBe("EMAIL_NOT_VERIFIED");
		env._sqlite.query("UPDATE users SET status = -1 WHERE id = 10").run();
		const banned = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "Denied" }),
		});
		expect(banned.status).toBe(403);
		expect((await banned.json()).error.code).toBe("USER_BANNED");
		expect(subject()).toEqual({ subject: "Verified edit" });
		expect(await env.KV.get(threadMetaGenKey(1))).toBe(generation);
	});

	test("denies an unrelated user with stale Admin claims and an author on a closed thread", async () => {
		const unrelated = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers: await userHeaders(20, 1),
			body: JSON.stringify({ subject: "Denied" }),
		});
		expect(unrelated.status).toBe(403);
		expect((await unrelated.json()).error.code).toBe("FORBIDDEN");
		env._sqlite.query("UPDATE threads SET closed = 1 WHERE id = 1").run();
		const closed = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers: await userHeaders(),
			body: JSON.stringify({ subject: "Denied" }),
		});
		expect(closed.status).toBe(403);
		expect(subject()).toEqual({ subject: "Original subject" });
	});

	test("allows the current forum moderator to edit a closed thread, then denies the same token after demotion", async () => {
		env._sqlite.query("UPDATE threads SET closed = 1 WHERE id = 1").run();
		const headers = await userHeaders(30, 3);
		const edited = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "Moderator edit" }),
		});
		expect(edited.status).toBe(200);
		expect((await edited.json()).data).toEqual({ id: 1, updated: true });
		env._sqlite.query("UPDATE users SET role = 0 WHERE id = 30").run();
		const denied = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers,
			body: JSON.stringify({ subject: "Denied" }),
		});
		expect(denied.status).toBe(403);
		expect(subject()).toEqual({ subject: "Moderator edit" });
	});

	test("returns a router error without publishing a generation when SQLite rejects the edit", async () => {
		env._sqlite.exec(
			"CREATE TRIGGER reject_subject BEFORE UPDATE OF subject ON threads BEGIN SELECT RAISE(ABORT, 'local subject write failure'); END",
		);
		const response = await workerFetch(env, "/api/v1/threads/1", {
			method: "PATCH",
			headers: await userHeaders(),
			body: JSON.stringify({ subject: "Rejected edit" }),
		});
		expect(response.status).toBe(500);
		expect(subject()).toEqual({ subject: "Original subject" });
		expect(await env.KV.get(threadMetaGenKey(1))).toBeNull();
	});
});

describe("L2-fast: statistics calibration routing", () => {
	test.each([undefined, "wrong-key", "test-api-key"])(
		"requires Key B for stored totals and both calibration methods (key=%s)",
		async (key) => {
			const headers = new Headers({ "Content-Type": "application/json" });
			if (key) headers.set("X-API-Key", key);
			const totals = await workerFetch(env, "/api/admin/stats", { method: "GET", headers });
			const get = await workerFetch(env, "/api/admin/stats/calibrate", { method: "GET", headers });
			const post = await workerFetch(env, "/api/admin/stats/calibrate", {
				method: "POST",
				headers,
				body: JSON.stringify({ action: "apply_real" }),
			});
			for (const response of [totals, get, post]) {
				expect(response.status).toBe(401);
				expect((await response.json()).error.code).toBe("UNAUTHORIZED");
			}
			expect(counters()).toEqual(initialCounters);
			expect(await env.KV.get(statsReportsGenKey())).toBeNull();
		},
	);

	test("Key B alone reads stored counters and the Shanghai day count, and stored values remain current", async () => {
		const headers = { "X-API-Key": env.ADMIN_API_KEY };
		const response = await workerFetch(env, "/api/admin/stats/calibrate", {
			method: "GET",
			headers,
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect((await response.json()).data).toEqual({
			counters: Object.entries(initialCounters).map(([key, value]) => ({
				key,
				stored: Number(value),
				real: null,
			})),
			todayPosts: 2,
			todayDate: shanghaiDateLocal(),
		});
		env._sqlite.query("UPDATE settings SET value = '91' WHERE key = 'stats.total_threads'").run();
		const fresh = await workerFetch(env, "/api/admin/stats/calibrate", { method: "GET", headers });
		expect((await fresh.json()).data.counters[0]).toEqual({
			key: "stats.total_threads",
			stored: 91,
			real: null,
		});
	});

	test("run_stats previews complete table counts, including hidden content and banned users, without changing counters", async () => {
		const response = await workerFetch(env, "/api/admin/stats/calibrate", {
			method: "POST",
			headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({ action: "run_stats" }),
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toContain("no-store");
		expect((await response.json()).data).toEqual({
			success: true,
			counters: [
				{ key: "stats.total_threads", stored: 90, real: 2 },
				{ key: "stats.total_posts", stored: 450, real: 4 },
				{ key: "stats.total_members", stored: 45, real: 4 },
				{ key: "stats.yesterday_posts", stored: 20, real: null },
			],
		});
		expect(counters()).toEqual(initialCounters);
		expect(await env.KV.get(statsReportsGenKey())).toBeNull();
	});

	test("apply_real commits all three totals and refreshes warm public and admin snapshots", async () => {
		const adminWarm = await workerFetch(env, "/api/admin/stats", {
			method: "GET",
			headers: { "X-API-Key": env.ADMIN_API_KEY },
		});
		expect((await adminWarm.json()).data).toMatchObject({
			users: { total: 45 },
			threads: { total: 90 },
			posts: { total: 450 },
			source: "stored-counters",
		});
		const warm = await workerFetch(env, "/api/v1/stats", {
			method: "GET",
			headers: { "X-API-Key": env.API_KEY },
		});
		expect((await warm.json()).data.totalPosts).toBe(450);
		await flushCurrentTestCtx();
		const response = await workerFetch(env, "/api/admin/stats/calibrate", {
			method: "POST",
			headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({ action: "apply_real" }),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ success: true });
		expect(counters()).toEqual({
			"stats.total_threads": "2",
			"stats.total_posts": "4",
			"stats.total_members": "4",
			"stats.yesterday_posts": "20",
		});
		expect(await env.KV.get(statsReportsGenKey())).not.toBeNull();
		const fresh = await workerFetch(env, "/api/v1/stats", {
			method: "GET",
			headers: { "X-API-Key": env.API_KEY },
		});
		expect((await fresh.json()).data).toMatchObject({
			totalThreads: 2,
			totalPosts: 4,
			totalMembers: 4,
			yesterdayPosts: 20,
			todayPosts: 2,
		});
		const adminFresh = await workerFetch(env, "/api/admin/stats", {
			method: "GET",
			headers: { "X-API-Key": env.ADMIN_API_KEY },
		});
		expect((await adminFresh.json()).data).toMatchObject({
			users: { total: 4 },
			threads: { total: 2 },
			posts: { total: 4 },
			source: "stored-counters",
		});
	});

	test("apply_offsets updates only the allowed counters and ignores zero or invalid adjustments", async () => {
		const response = await workerFetch(env, "/api/admin/stats/calibrate", {
			method: "POST",
			headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "apply_offsets",
				offsets: {
					"stats.total_threads": 5,
					"stats.total_posts": -10,
					"stats.total_members": "100",
					"stats.yesterday_posts": 0,
					"routing.marker": 7,
				},
			}),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).data).toEqual({ success: true });
		expect(counters()).toEqual({
			...initialCounters,
			"stats.total_threads": "95",
			"stats.total_posts": "440",
		});
		expect(
			env._sqlite.query("SELECT value FROM settings WHERE key = 'routing.marker'").get(),
		).toEqual({
			value: "unchanged",
		});
		const generation = await env.KV.get(statsReportsGenKey());
		expect(generation).not.toBeNull();
		const noOp = await workerFetch(env, "/api/admin/stats/calibrate", {
			method: "POST",
			headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({ action: "apply_offsets", offsets: { "stats.total_posts": 0 } }),
		});
		expect(noOp.status).toBe(200);
		expect(await env.KV.get(statsReportsGenKey())).toBe(generation);
	});

	test("a rejected calibration write rolls back earlier updates and leaves the cached totals valid", async () => {
		await workerFetch(env, "/api/v1/stats", {
			method: "GET",
			headers: { "X-API-Key": env.API_KEY },
		});
		await flushCurrentTestCtx();
		const cached = await env.KV.get("public-stats");
		env._sqlite.exec(
			"CREATE TRIGGER reject_calibration BEFORE UPDATE OF value ON settings WHEN NEW.key = 'stats.total_posts' BEGIN SELECT RAISE(ABORT, 'local calibration write failure'); END",
		);
		const response = await workerFetch(env, "/api/admin/stats/calibrate", {
			method: "POST",
			headers: { "X-API-Key": env.ADMIN_API_KEY, "Content-Type": "application/json" },
			body: JSON.stringify({ action: "apply_real" }),
		});
		expect(response.status).toBe(500);
		expect(counters()).toEqual(initialCounters);
		expect(await env.KV.get("public-stats")).toBe(cached);
		expect(await env.KV.get(statsReportsGenKey())).toBeNull();
	});
});
