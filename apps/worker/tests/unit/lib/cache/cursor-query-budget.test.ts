import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rebuildPrivateCache } from "../../../../src/lib/cache/private-read";
import { loadUserHistory } from "../../../../src/lib/cache/user-read";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
});
afterEach(() => f.close());

interface Page {
	items: { id: number; createdAt: number; threadId?: number }[];
	nextCursor: string | null;
}

const cases = [
	{ family: "user:threads", index: "idx_threads_author", alias: "t", box: null },
	{ family: "user:posts", index: "idx_posts_author", alias: "p", box: null },
	{ family: "user:digest", index: "idx_threads_author", alias: "t", box: null },
	{ family: "pm:list", index: "idx_messages_receiver", alias: "", box: "inbox" },
	{ family: "pm:list", index: "idx_messages_sender", alias: "", box: "outbox" },
] as const;

function seed(family: string) {
	if (family === "pm:list") {
		f.sqlite.exec(`WITH RECURSIVE rows(n) AS (
			SELECT 1 UNION ALL SELECT n + 1 FROM rows WHERE n < 12000
		) INSERT INTO messages (id, sender_id, sender_name, receiver_id, receiver_name,
			content, created_at, sender_deleted, receiver_deleted)
		SELECT n, CASE WHEN n % 19 = 0 THEN 30 ELSE 10 END, 'sender',
			CASE WHEN n % 23 = 0 THEN 30 ELSE 10 END, 'receiver', 'message',
			10000 + n / 3, n % 17 = 0, n % 13 = 0 FROM rows`);
		return;
	}
	f.sqlite.exec(`WITH RECURSIVE rows(n) AS (
		SELECT 1 UNION ALL SELECT n + 1 FROM rows WHERE n < 12000
	) INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at,
		last_post_at, sticky, anonymous_author, digest)
	SELECT n, CASE WHEN n % 13 = 0 THEN 2 WHEN n % 29 = 0 THEN 3 ELSE 1 END,
		CASE WHEN n % 19 = 0 THEN 20 ELSE 10 END, 'author', 'thread',
		10000 + n / 3, 10000 + n / 3, CASE WHEN n % 17 = 0 THEN -1 ELSE 0 END,
		n % 11 = 0, n % 2 = 0 FROM rows`);
	if (family === "user:posts") {
		f.sqlite.exec(`INSERT INTO posts (id, thread_id, forum_id, author_id, author_name,
			content, created_at, position, invisible, is_first, anonymous)
		SELECT id, id, forum_id, author_id, author_name, 'reply', created_at, 2,
			id % 7 = 0, id % 5 = 0, id % 11 = 0 FROM threads`);
	}
}

async function read(d: CacheDescriptor): Promise<Page> {
	return d.family === "pm:list"
		? (rebuildPrivateCache(f.env, undefined, d) as Promise<Page>)
		: loadUserHistory(f.env, d);
}

describe("deep history and mailbox cursor query budgets", () => {
	it.each(cases)("$family $box seeks by time before filtering a deep page", async (test) => {
		seed(test.family);
		const d: CacheDescriptor = {
			family: test.family,
			scope: test.box ? "user:10" : "anon",
			params: {
				userId: 10,
				limit: 20,
				cursorTime: 11000,
				cursorId: 3002,
				...(test.box ? { box: test.box } : {}),
			},
		};
		const page = await read(d);
		expect(f.calls).toHaveLength(1);
		const call = f.calls[0];
		const column = test.alias ? `${test.alias}.` : "";
		const tuple = `(${column}created_at, ${column}id) < (?, ?)`;
		const legacyPredicate = `(${column}created_at < ? OR (${column}created_at = ? AND ${column}id < ?))`;
		const legacySql = call.sql.replace(tuple, legacyPredicate);
		const legacy = f.sqlite.prepare(legacySql).all(10, 11000, 11000, 3002, 41);
		expect(page.items).toEqual(legacy.slice(0, 20));
		expect(page.items).toHaveLength(20);
		expect(page.items[0]).toMatchObject({
			id: test.family === "user:digest" ? 3000 : 3001,
			createdAt: 11000,
		});
		expect(page.nextCursor).toEqual(expect.any(String));
		const last = page.items.at(-1);
		const next = await read({
			...d,
			params: { ...d.params, cursorTime: last?.createdAt ?? 0, cursorId: last?.id ?? 0 },
		});
		expect([...page.items, ...next.items]).toEqual(legacy.slice(0, 40));
		expect(new Set([...page.items, ...next.items].map((row) => row.id)).size).toBe(40);
		expect(f.calls.every((entry) => entry.mode === "all")).toBe(true);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();

		// Derive both plans from the actual loader SQL, so a query regression fails this budget.
		const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${call.sql}`).all(...call.params);
		const legacyPlan = f.sqlite
			.prepare(`EXPLAIN QUERY PLAN ${legacySql}`)
			.all(10, 11000, 11000, 3002, 21);
		expect(legacyPlan.map((row) => String(row.detail)).join("\n")).not.toContain("created_at<?");
		expect(plan.map((row) => String(row.detail)).join("\n")).toMatch(
			new RegExp(`SEARCH .* USING (?:COVERING )?INDEX ${test.index} \\([^)]*created_at<\\?\\)`),
		);
		expect(call.params).toEqual([10, 11000, 3002, 21]);
	});
});
