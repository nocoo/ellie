import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	rebuildAdminReportCache,
	shanghaiStart,
} from "../../../../src/lib/cache/admin-report-read";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(() => {
	f = readingFixture();
	f.thread(1);
	f.insert("forums", { id: 4, name: "Deleted", status: -1 });
	// Include legacy orphan forum references handled by the existing LEFT JOIN.
	f.sqlite.exec("PRAGMA foreign_keys = OFF");
	const start = shanghaiStart("2026-09-17");
	f.sqlite
		.prepare(`WITH RECURSIVE rows(n) AS (
			SELECT 1 UNION ALL SELECT n + 1 FROM rows WHERE n < 10200
		) INSERT INTO posts (id, thread_id, forum_id, author_id, author_name,
			content, created_at, position)
		SELECT n, 1, CASE WHEN n % 5 = 0 THEN 999 ELSE n % 5 END,
			10, 'author', 'reply', ? - CASE WHEN n <= 10000 THEN 365 * 86400
			ELSE (n % 100) * 86400 END, n FROM rows`)
		.run(start);
	f.sqlite.exec("PRAGMA foreign_keys = ON");
});
afterEach(() => f.close());

describe("admin forum distribution query budget", () => {
	it.each(["7d", "30d", "90d"])(
		"%s searches the time range before grouping forums",
		async (range) => {
			const d: CacheDescriptor = {
				family: "admin:analytics",
				scope: "admin",
				params: { resource: "analytics", operation: "forum-dist", date: "2026-09-17", range },
			};
			const value = (await rebuildAdminReportCache(f.env, undefined, d)) as {
				range: string;
				rows: { forumId: number; forumName: string; posts: number }[];
			};
			expect(f.calls).toHaveLength(1);
			const call = f.calls[0];
			const legacySql = call.sql.replace(" INDEXED BY idx_posts_created", "");
			const legacy = f.sqlite.prepare(legacySql).all(...call.params);
			expect(value).toEqual({
				range,
				rows: legacy.map((row) => ({
					forumId: row.forum_id,
					forumName: row.forum_name,
					posts: row.posts,
				})),
			});
			// Existing report semantics include paused forums, but omit deleted/missing forums.
			expect(value.rows.map((row) => row.forumId).sort()).toEqual([1, 2, 3]);
			expect(f.env.KV.get).not.toHaveBeenCalled();
			expect(f.env.KV.put).not.toHaveBeenCalled();
			const plan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${call.sql}`).all(...call.params);
			const legacyPlan = f.sqlite.prepare(`EXPLAIN QUERY PLAN ${legacySql}`).all(...call.params);
			expect(legacyPlan.map((row) => String(row.detail)).join("\n")).toContain("SCAN p");
			expect(plan.map((row) => String(row.detail)).join("\n")).toContain(
				"SEARCH p USING INDEX idx_posts_created (created_at>?)",
			);
			expect(plan.map((row) => String(row.detail)).join("\n")).not.toContain("SCAN p");
			expect(call.params).toHaveLength(2);
		},
	);
});
