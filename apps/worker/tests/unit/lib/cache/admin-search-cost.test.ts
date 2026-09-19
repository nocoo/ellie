import { afterEach, beforeEach, expect, it } from "vitest";
import { list as posts } from "../../../../src/handlers/admin/post";
import { list as threads } from "../../../../src/handlers/admin/thread";
import { list as users } from "../../../../src/handlers/admin/user";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
});
afterEach(() => {
	f.close();
});
it.each([
	[threads, "threads?subject=test"],
	[threads, "threads?subject=test&forumId=oops"],
	[posts, "posts?content=test&authorId=0"],
	[posts, "posts?content=test&createdAtMin=1"],
] as const)(
	"rejects unrestricted contains searches before accessing D1",
	async (handler, query) => {
		const res = await handler(createAdminRequest("GET", `/api/admin/${query}`), f.env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("SEARCH_SCOPE_REQUIRED");
		expect(f.calls).toHaveLength(0);
	},
);
it.each([
	[threads, "threads?subject=Thread&forumId=1"],
	[threads, "threads?subject=Thread&authorId=10"],
	[posts, "posts?content=Body&authorName=ALICE"],
	[posts, "posts?content=Body&threadId=1"],
] as const)("retains scoped title and body substring searches", async (handler, query) => {
	f.thread(1);
	f.post(1);
	const res = await handler(createAdminRequest("GET", `/api/admin/${query}`), f.env);
	expect(res.status).toBe(200);
	expect((await res.json()).data.map((r: { id: number }) => r.id)).toEqual([1]);
});
it("uses indexed exact email, UID, literal prefix and same-IP filters", async () => {
	f.sqlite.exec(
		"UPDATE users SET email_normalized='alice@example.com', reg_ip='127.0.0.1', last_ip='127.0.0.2' WHERE id=10",
	);
	for (const query of [
		"email=%20ALICE%40EXAMPLE.COM%20",
		"id=10",
		"username=AL",
		"regIp=127.0.0.1",
		"lastIp=127.0.0.2",
	]) {
		f.calls.length = 0;
		const res = await users(createAdminRequest("GET", `/api/admin/users?${query}`), f.env);
		expect((await res.json()).data.map((r: { id: number }) => r.id)).toEqual([10]);
		for (const call of f.calls) {
			const plan = f.sqlite
				.prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
				.all(...call.params)
				.map((r) => r.detail)
				.join("\n");
			expect(plan).not.toContain("SCAN users");
		}
	}
	const res = await users(createAdminRequest("GET", "/api/admin/users?username=a_"), f.env);
	expect((await res.json()).data).toEqual([]);
});
