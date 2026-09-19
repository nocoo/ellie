import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { list as attachments } from "../../../../src/handlers/admin/attachment";
import { list as posts } from "../../../../src/handlers/admin/post";
import { getThreadListPage } from "../../../../src/lib/cache/thread-list-read";
import { getUserSearchCached } from "../../../../src/lib/cache/user-read";
import { createAdminRequest } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-20T00:00:00Z"));
	f = readingFixture();
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
});
it("prefix search uses a NOCASE index, escapes wildcard characters and caches empty results for an hour", async () => {
	f.insert("users", { id: 301, username: "A_%one" });
	f.insert("users", { id: 302, username: "ABtwo" });
	f.insert("users", { id: 303, username: "A_%banned", status: -1 });
	expect(await getUserSearchCached(f.env, undefined, "A_%", 10)).toEqual([
		{ id: 301, username: "A_%one" },
	]);
	const call = f.calls[0];
	const plan = f.sqlite
		.prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
		.all(...call.params)
		.map((r) => r.detail)
		.join("\n");
	expect(plan).toContain("SEARCH users USING INDEX idx_users_username_nocase");
	await getUserSearchCached(f.env, undefined, "中文", 10);
	expect(f.snapshots("user:search").every((s) => s.tier === "HOUR")).toBe(true);
	f.calls.length = 0;
	vi.setSystemTime(Date.now() + 3_599_999);
	await getUserSearchCached(f.env, undefined, "a_%", 10);
	await getUserSearchCached(f.env, undefined, "中文", 10);
	expect(f.calls).toHaveLength(0);
	vi.setSystemTime(Date.now() + 1);
	await getUserSearchCached(f.env, undefined, "中文", 10);
	expect(f.calls).toHaveLength(1);
});
it.each([
	["attachments", attachments, "idx_attachments_created"],
	["posts", posts, "idx_posts_created"],
] as const)(
	"%s uses its time index for a recent start-only date filter",
	async (table, handler, index) => {
		const min = Math.floor(Date.now() / 1000) - 86400;
		expect(
			(await handler(createAdminRequest("GET", `/api/admin/${table}?createdAtMin=${min}`), f.env))
				.status,
		).toBe(200);
		for (const call of f.calls) {
			expect(call.sql).toContain(`INDEXED BY ${index}`);
			const plan = f.sqlite
				.prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
				.all(...call.params)
				.map((r) => r.detail)
				.join("\n");
			expect(plan).toContain(`SEARCH ${table} USING`);
		}
	},
);
it("category counts and pages seek both forum and type while preserving pins", async () => {
	f.thread(1, { type_id: 1, sticky: 2 });
	f.thread(2, { type_id: 1, sticky: 1 });
	f.thread(3, { type_id: 2 });
	const page = await getThreadListPage(f.env, undefined, {
		forumId: 1,
		typeId: 1,
		limit: 20,
		page: 1,
		cursor: null,
	});
	expect(page.items.map((row) => row.id)).toEqual([1, 2]);
	expect(page.total).toBe(2);
	for (const call of f.calls.filter((c) => c.sql.includes("type_id = ?"))) {
		const plan = f.sqlite
			.prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
			.all(...call.params)
			.map((r) => r.detail)
			.join("\n");
		expect(plan).toContain("idx_threads_forum_type (forum_id=? AND type_id=?)");
	}
});
