import { encodeGenericCursor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as user from "../../../src/handlers/user";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
});
afterEach(() => f.close());
function request(path: string, token?: string) {
	return new Request(`https://api.example.com/api/v1/${path}`, {
		headers: {
			Origin: "http://localhost:7031",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
	});
}
async function body(response: Promise<Response>) {
	return (await response).json();
}

describe("user profiles and avatar paths", () => {
	it("maps an explicit public field allowlist and separates stable values from dynamic counters", async () => {
		f.sqlite.exec(
			"UPDATE users SET threads=3, posts=8, credits=50, coins=4, signature='sig', reg_ip='secret ip', last_ip='private ip' WHERE id=10",
		);
		f.insert("user_checkins", {
			user_id: 10,
			total_days: 8,
			month_days: 3,
			streak_days: 2,
			last_checkin_at: 100,
		});
		const result = await body(user.getById(request("users/10"), f.env));
		expect(result.data).toMatchObject({
			id: 10,
			username: "alice",
			avatarPath: "alice.jpg",
			threads: 3,
			posts: 8,
			credits: 50,
			coins: 4,
			signature: "sig",
			checkin: { totalDays: 8 },
		});
		for (const field of ["email", "password_hash", "password_salt", "regIp", "lastIp"])
			expect(result.data).not.toHaveProperty(field);
		const stable = JSON.parse(
			f.values.get("user:public:v2:10:public") ?? expect.fail("Missing public user snapshot"),
		);
		const stats = JSON.parse(
			f.values.get("user:stats:10") ?? expect.fail("Missing user stats snapshot"),
		);
		expect(stable.tier).toBe("MEDIUM");
		expect(stats.tier).toBe("SHORT");
		expect(stable.data).not.toHaveProperty("threads");
		expect(stable.data).not.toHaveProperty("checkin");
		f.calls.length = 0;
		expect((await body(user.getById(request("users/10"), f.env))).data).toEqual(result.data);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).toContain("SELECT id, status");
	});
	it("keeps staff IP projection in its original scope", async () => {
		f.sqlite.exec("UPDATE users SET reg_ip='1.2.3.4', last_ip='2.3.4.5' WHERE id=10");
		const token = await createJwtForRole(3, 30);
		const staff = await body(user.getById(request("users/10", token), f.env));
		expect(staff.data).toMatchObject({ regIp: "1.2.3.4", lastIp: "2.3.4.5" });
		expect((await body(user.getById(request("users/10"), f.env))).data).not.toHaveProperty("regIp");
	});
	it.each(["abc", "-1", "0", "999"])("returns 404 for missing/invalid user %s", async (id) => {
		expect((await user.getById(request(`users/${id}`), f.env)).status).toBe(404);
	});
	it.each([-1, -2, -3])(
		"honors current user status %s even when profile is hot",
		async (status) => {
			await user.getById(request("users/10"), f.env);
			f.sqlite.prepare("UPDATE users SET status=? WHERE id=10").run(status);
			expect((await user.getById(request("users/10"), f.env)).status).toBe(404);
		},
	);
	it("returns a LONG avatar mapping without applying the public-profile status filter", async () => {
		f.sqlite.exec("UPDATE users SET status=-1 WHERE id=10");
		expect((await body(user.getAvatarPath(request("users/10/avatar-path"), f.env))).data).toEqual({
			avatarPath: "alice.jpg",
		});
		expect(
			JSON.parse(f.values.get("user:avatar-path:10") ?? expect.fail("Missing avatar snapshot"))
				.tier,
		).toBe("LONG");
		f.calls.length = 0;
		await user.getAvatarPath(request("users/10/avatar-path"), f.env);
		expect(f.calls).toHaveLength(0);
	});
	it("handles an empty path, missing user, and invalid avatar ID", async () => {
		f.sqlite.exec("UPDATE users SET avatar_path='' WHERE id=10");
		expect((await body(user.getAvatarPath(request("users/10/avatar-path"), f.env))).data).toEqual({
			avatarPath: "",
		});
		expect((await user.getAvatarPath(request("users/999/avatar-path"), f.env)).status).toBe(404);
		expect((await user.getAvatarPath(request("users/abc/avatar-path"), f.env)).status).toBe(400);
	});
});

describe("user history with current gates", () => {
	it.each(["threads", "digest"] as const)(
		"paginates %s using membership and shared entities",
		async (kind) => {
			for (let id = 1; id <= 4; id++) f.thread(id, { digest: 1 });
			const handler = kind === "threads" ? user.listThreads : user.listDigest;
			const first = await body(handler(request(`users/10/${kind}?limit=2`), f.env));
			expect(first.data.map((row: { id: number }) => row.id)).toEqual([4, 3]);
			const second = await body(
				handler(
					request(`users/10/${kind}?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor)}`),
					f.env,
				),
			);
			expect(second.data.map((row: { id: number }) => row.id)).toEqual([2, 1]);
			expect(second.meta.nextCursor).toBeNull();
			f.calls.length = 0;
			await handler(request(`users/10/${kind}?limit=2`), f.env);
			expect(f.calls).toHaveLength(1);
			expect(f.calls[0].sql).toContain("JOIN forums f");
		},
	);
	it("projects names from user mini and excludes anonymous history after the flag changes", async () => {
		f.thread(1);
		await user.listThreads(request("users/10/threads"), f.env);
		f.sqlite.exec("UPDATE threads SET anonymous_author=1 WHERE id=1");
		expect((await body(user.listThreads(request("users/10/threads"), f.env))).data).toEqual([]);
		const self = await createJwtForRole(0, 10);
		const mod = await createJwtForRole(3, 30);
		for (const token of [self, mod])
			expect(
				(await body(user.listThreads(request("users/10/threads", token), f.env))).data[0],
			).toMatchObject({ authorId: 10, authorName: "alice" });
	});
	it.each([
		"UPDATE threads SET sticky=-1 WHERE id=1",
		"UPDATE forums SET visibility='staff' WHERE id=1",
		"UPDATE forums SET status=0 WHERE id=1",
		"UPDATE threads SET author_id=20 WHERE id=1",
	])("gates a hot thread history: %s", async (sql) => {
		f.thread(1);
		await user.listThreads(request("users/10/threads"), f.env);
		f.sqlite.exec(sql);
		expect((await body(user.listThreads(request("users/10/threads"), f.env))).data).toEqual([]);
	});
	it("paginates post history with distinct thread/post IDs and excludes first posts", async () => {
		f.thread(30, { subject: "Target", created_at: 900 });
		f.post(1, { thread_id: 30, is_first: 1 });
		for (let id = 2; id <= 5; id++) f.post(id, { thread_id: 30, is_first: 0, created_at: id * 10 });
		const first = await body(user.listPosts(request("users/10/posts?limit=2"), f.env));
		expect(first.data.map((row: { post: { id: number } }) => row.post.id)).toEqual([5, 4]);
		expect(first.data[0].thread).toMatchObject({ id: 30, subject: "Target", createdAt: 900 });
		expect(JSON.parse(atob(first.meta.nextCursor))).toEqual({ createdAt: 40, id: 4 });
		const next = await body(
			user.listPosts(
				request(`users/10/posts?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor)}`),
				f.env,
			),
		);
		expect(next.data.map((row: { post: { id: number } }) => row.post.id)).toEqual([3, 2]);
		expect(next.meta.nextCursor).toBeNull();
	});
	it.each([
		"UPDATE posts SET invisible=-1 WHERE id=2",
		"UPDATE posts SET anonymous=1 WHERE id=2",
		"UPDATE posts SET author_id=20 WHERE id=2",
		"UPDATE posts SET thread_id=2 WHERE id=2",
		"UPDATE threads SET sticky=-1 WHERE id=1",
	])("gates hot post history: %s", async (sql) => {
		f.thread(1);
		f.thread(2);
		f.post(2, { is_first: 0 });
		await user.listPosts(request("users/10/posts"), f.env);
		f.sqlite.exec(sql);
		expect((await body(user.listPosts(request("users/10/posts"), f.env))).data).toEqual([]);
	});
	it("keeps post history origin queries bounded across 50 threads", async () => {
		for (let id = 1; id <= 50; id++) {
			f.thread(id);
			f.post(id + 100, { thread_id: id, is_first: 0 });
		}
		const data = await body(user.listPosts(request("users/10/posts?limit=50"), f.env));
		expect(data.data).toHaveLength(50);
		expect(f.calls).toHaveLength(7);
		expect(Math.max(...f.calls.map((c) => c.params.length))).toBeLessThanOrEqual(100);
		f.calls.length = 0;
		await user.listPosts(request("users/10/posts?limit=50"), f.env);
		expect(f.calls).toHaveLength(2);
	});
	it.each([user.listThreads, user.listPosts, user.listDigest])(
		"validates resource IDs and returns an empty page",
		async (handler) => {
			expect((await handler(request("users/abc/threads"), f.env)).status).toBe(400);
			expect(
				(await body(handler(request("users/10/threads?limit=garbage&cursor=invalid"), f.env))).data,
			).toEqual([]);
		},
	);
	it("keeps staff histories scoped by role and supports valid explicit cursors", async () => {
		f.thread(1, { digest: 1, anonymous_author: 1 });
		const token = await createJwtForRole(3, 30);
		const result = await body(
			user.listDigest(
				request(`users/10/digest?cursor=${encodeGenericCursor({ createdAt: 10, id: 10 })}`, token),
				f.env,
			),
		);
		expect(result.data[0]).toMatchObject({ authorId: 10, digest: 1 });
	});
});

describe("user search", () => {
	it.each(["", "a"])("rejects short query %s", async (q) =>
		expect((await user.search(request(`users/search?q=${q}`), f.env)).status).toBe(400),
	);
	it("caches normalized ASCII search and checks current active users", async () => {
		expect((await body(user.search(request("users/search?q=AL&limit=1"), f.env))).data).toEqual([
			{ id: 10, username: "alice" },
		]);
		f.calls.length = 0;
		await user.search(request("users/search?q=al&limit=1"), f.env);
		expect(f.calls).toHaveLength(1);
		f.sqlite.exec("UPDATE users SET status=-1 WHERE id=10");
		expect((await body(user.search(request("users/search?q=al&limit=1"), f.env))).data).toEqual([]);
	});
	it("escapes LIKE wildcards and handles no matches without a permission query", async () => {
		f.insert("users", { id: 40, username: "a_percent", email_verified_at: 1 });
		expect((await body(user.search(request("users/search?q=a_"), f.env))).data).toEqual([
			{ id: 40, username: "a_percent" },
		]);
		expect(
			(await body(user.search(request("users/search?q=missing&limit=abc"), f.env))).data,
		).toEqual([]);
	});
});
