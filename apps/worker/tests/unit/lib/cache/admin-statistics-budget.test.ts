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

describe("narrow date list plans", () => {
	it.each([
		{ entity: "users", date: "reg_date", param: "regDate", index: "idx_users_reg_date" },
		{ entity: "threads", date: "created_at", param: "createdAt", index: "idx_threads_created" },
	])(
		"$entity seeks dates but preserves ID ordering and pagination",
		async ({ entity, date, param, index }) => {
			const now = Math.floor(Date.now() / 1000);
			if (entity === "users") {
				f.sqlite.exec(`WITH RECURSIVE n(id) AS (VALUES (100) UNION ALL SELECT id+1 FROM n WHERE id<10100)
			INSERT INTO users(id,username,reg_date) SELECT id,'history-'||id,100 FROM n`);
			} else {
				f.sqlite.exec(`WITH RECURSIVE n(id) AS (VALUES (100) UNION ALL SELECT id+1 FROM n WHERE id<10100)
			INSERT INTO threads(id,forum_id,author_id,subject,created_at) SELECT id,1,10,'history',100 FROM n`);
			}
			f.sqlite.exec(
				`UPDATE ${entity} SET ${date}=${now - 100} WHERE id=100; UPDATE ${entity} SET ${date}=${now - 200} WHERE id=101`,
			);
			const descriptor = {
				family: "admin:entity:list",
				scope: "admin",
				params: { entity, query: `${param}Min=${now - 86400}&limit=1&page=1` },
			};
			// Canonical query key order is lexical (createdAt/limit/page versus limit/page/regDate).
			descriptor.params.query = new URLSearchParams(
				[...new URLSearchParams(descriptor.params.query)].sort(([a], [b]) => a.localeCompare(b)),
			).toString();
			const page = await readAdminEntity<List>(f.env, undefined, descriptor);
			expect(page.total).toBe(2);
			expect(page.items.map((row) => row.id)).toEqual([101]);
			for (const call of f.calls) {
				const plan = f.sqlite
					.prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
					.all(...call.params)
					.map((row) => String(row.detail))
					.join("\n");
				expect(plan).toContain(index);
				expect(plan).toContain(`${date}>?`);
			}
			const last =
				f.calls.find((call) => call.sql.includes("ORDER BY")) ?? expect.fail("Missing list query");
			expect(
				f.sqlite
					.prepare(last.sql.replace(` INDEXED BY ${index}`, ""))
					.all(...last.params)
					.map((row) => row.id),
			).toEqual([101]);
			f.calls.length = 0;
			await readAdminEntity(f.env, undefined, descriptor);
			expect(f.calls).toHaveLength(0);
		},
	);
});
