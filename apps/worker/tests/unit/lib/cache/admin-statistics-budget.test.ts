import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(Date.parse("2026-09-17T12:00:00Z"));
	f = readingFixture();
	f.thread(1, { replies: 8, last_post_at: 100, last_poster: "stored" });
	f.sqlite.exec(`
		WITH RECURSIVE n(id) AS (VALUES (1) UNION ALL SELECT id + 1 FROM n WHERE id < 10000)
		INSERT INTO posts (id, thread_id, forum_id, author_id, author_name, content, position, created_at)
		SELECT id, 1, 1, 10, 'alice', 'body', id, id FROM n;
		UPDATE forums SET threads = 7, posts = 9, last_thread_id = 1, last_post_at = 100 WHERE id = 1;
		UPDATE users SET threads = 3, posts = 4, digest_posts = 2 WHERE id = 10;
	`);
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
});

type List = { items: Record<string, unknown>[]; total: number };

describe("admin list statistics budgets", () => {
	it.each([
		{
			entity: "forums",
			query: "",
			sqls: 1,
			id: 1,
			expected: { threads: 7, posts: 9, lastPostAt: 100 },
		},
		{
			entity: "threads",
			query: "limit=20&page=1",
			sqls: 2,
			id: 1,
			expected: { replies: 8, lastPostAt: 100, lastPoster: "stored" },
		},
		{
			entity: "users",
			query: "limit=20&page=1",
			sqls: 2,
			id: 10,
			expected: { threads: 3, posts: 4, digestPosts: 2 },
		},
	])(
		"$entity reads maintained metadata without scanning related tables",
		async ({ entity, query, sqls, id, expected }) => {
			const descriptor: CacheDescriptor = {
				family: "admin:entity:list",
				scope: "admin",
				params: { entity, query },
			};
			const result = await readAdminEntity<List>(f.env, undefined, descriptor);
			const row = result.items.find((item) => item.id === id);
			expect(row).toMatchObject(expected);
			expect(row).not.toHaveProperty("messagesCount");
			expect(row).not.toHaveProperty("attachmentsCount");
			expect(f.calls).toHaveLength(sqls);
			for (const call of f.calls) {
				const tables = [...call.sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)].map((match) => match[1]);
				expect(new Set(tables)).toEqual(new Set([entity]));
				const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${call.sql}`).all(...call.params);
				expect(plan.some((step) => /CORRELATED/.test(String(step.detail)))).toBe(false);
			}
			f.calls.length = 0;
			expect(await readAdminEntity(f.env, undefined, descriptor)).toEqual(result);
			expect(f.calls).toHaveLength(0);
		},
	);
});
