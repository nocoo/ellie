import type { SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCatalogPage, rebuildCatalogCache } from "../../../../src/lib/cache/catalog-read";
import { readingFixture } from "./thread-cache-fixture";

type Fixture = ReturnType<typeof readingFixture>;
type PlanRow = { detail: string };

function explain(f: Fixture, sql: string, params: SQLInputValue[] = []) {
	return f.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as PlanRow[];
}

function captured(f: Fixture, match: (sql: string) => boolean) {
	const call = f.calls.find((row) => match(row.sql));
	expect(call).toBeDefined();
	return call as (typeof f.calls)[number];
}

function withoutPlanHints(sql: string) {
	return sql
		.replace(/\s+INDEXED BY idx_threads_digest\s+/g, " ")
		.replace(/\bCROSS JOIN threads t ON\b/g, "JOIN threads t ON");
}

function rows(f: Fixture, sql: string, params: SQLInputValue[]) {
	return f.sqlite.prepare(sql).all(...params);
}

function expectItemsMatchUnhinted(f: Fixture, sql: string, params: SQLInputValue[]) {
	const hinted = rows(f, sql, params);
	expect(rows(f, withoutPlanHints(sql), params)).toEqual(hinted);
	return hinted;
}

const sitewide = {
	family: "digest:list" as const,
	scope: "role:anon",
	params: {
		bucket: "anon",
		forumId: null as number | null,
		level: null as number | null,
		year: null as number | null,
		limit: 20,
		cursorDigest: null as number | null,
		cursorTime: null as number | null,
		cursorId: null as number | null,
	},
};

describe("catalog query plan budget", () => {
	let f: Fixture;

	beforeEach(() => {
		f = readingFixture();
		f.sqlite
			.prepare(`WITH RECURSIVE historical(n) AS (
				SELECT 1 UNION ALL SELECT n + 1 FROM historical WHERE n < 10000
			) INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at,
				last_post_at, last_poster_id, last_poster, sticky, digest)
			SELECT 100000 + n, 1, 10, 'alice', 'Historical', n, n, 20, 'bob', 0, 0 FROM historical`)
			.run();
		f.sqlite
			.prepare(`WITH RECURSIVE recs(n) AS (
				SELECT 1 UNION ALL SELECT n + 1 FROM recs WHERE n < 20
			) INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at,
				last_post_at, last_poster_id, last_poster, sticky, digest)
			SELECT 200000 + n, 1, 10, 'alice', 'Recommended ' || n, 200000 + n, 200000 + n, 20, 'bob', 0, 0
			FROM recs`)
			.run();
		f.sqlite
			.prepare(`WITH RECURSIVE recs(n) AS (
				SELECT 1 UNION ALL SELECT n + 1 FROM recs WHERE n < 20
			) INSERT INTO forum_recommended_threads (forum_id, thread_id, recommended_at, recommended_by)
			SELECT 1, 200000 + n, 300000 + n, 1 FROM recs`)
			.run();
		f.sqlite
			.prepare(`WITH RECURSIVE digests(n) AS (
				SELECT 1 UNION ALL SELECT n + 1 FROM digests WHERE n < 450
			) INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at,
				last_post_at, last_poster_id, last_poster, sticky, digest)
			SELECT 300000 + n, 1, 10, 'alice', 'Digest ' || n, 1_711_540_800 + n,
				400000 + n, 20, 'bob', 0, 1 + ((n - 1) % 3) FROM digests`)
			.run();
		f.thread(400001, {
			forum_id: 2,
			digest: 3,
			created_at: 1_711_540_800,
			last_post_at: 900000,
			sticky: 0,
		});
	});

	afterEach(() => f.close());

	it("drives recommended membership from r via CROSS JOIN and skips hidden, moved, and removed rows", async () => {
		f.sqlite.prepare("UPDATE threads SET sticky = -1 WHERE id = 200020").run();
		f.sqlite.prepare("UPDATE threads SET forum_id = 2 WHERE id = 200018").run();
		f.sqlite.prepare("DELETE FROM forum_recommended_threads WHERE thread_id = 200017").run();
		f.calls.length = 0;

		const page = await loadCatalogPage(f.env, {
			family: "recommended:threads",
			scope: "internal",
			params: { forumId: 1 },
		});
		expect(page.hasMore).toBe(false);
		expect(page.items).toEqual([
			{ id: 200019, recommendedAt: 300019 },
			{ id: 200016, recommendedAt: 300016 },
			{ id: 200015, recommendedAt: 300015 },
			{ id: 200014, recommendedAt: 300014 },
			{ id: 200013, recommendedAt: 300013 },
			{ id: 200012, recommendedAt: 300012 },
		]);
		expect(page.items).toHaveLength(6);
		expect(page.items.some((row) => [200020, 200018, 200017].includes(row.id))).toBe(false);

		const call = captured(f, (sql) => sql.includes("FROM forum_recommended_threads r"));
		expect(call.sql).toContain(
			"CROSS JOIN threads t ON t.id = r.thread_id AND t.forum_id = r.forum_id",
		);
		expect(call.sql.includes(" r JOIN threads t ")).toBe(false);
		const plan = explain(f, call.sql, call.params);
		expect(
			plan.some((row) =>
				row.detail.includes(
					"SEARCH r USING INDEX idx_forum_recommended_threads_forum_tid (forum_id=?)",
				),
			),
		).toBe(true);
		expect(plan.some((row) => row.detail.includes("idx_threads_forum"))).toBe(false);
		expectItemsMatchUnhinted(f, call.sql, call.params);

		const puts = vi.mocked(f.env.KV.put).mock.calls.length;
		const rebuilt = await rebuildCatalogCache(f.env, f.ctx, {
			family: "recommended:threads",
			scope: "internal",
			params: { forumId: 1 },
		});
		expect(rebuilt).toEqual(page);
		expect(vi.mocked(f.env.KV.put).mock.calls).toHaveLength(puts);
	});

	it("uses idx_threads_digest for sitewide digest lists including level and cursor pages", async () => {
		f.calls.length = 0;
		const first = await loadCatalogPage(f.env, sitewide);
		expect(first.hasMore).toBe(true);
		expect(first.items).toHaveLength(20);
		expect(first.items.every((row) => row.id !== 400001)).toBe(true);
		expect(
			first.items.map((row) => ({ id: row.id, lastPostAt: row.lastPostAt, digest: row.digest })),
		).toEqual(first.items);
		const ordered = [...first.items].sort((a, b) => {
			if (a.digest !== b.digest) return (b.digest ?? 0) - (a.digest ?? 0);
			if (a.lastPostAt !== b.lastPostAt) return (b.lastPostAt ?? 0) - (a.lastPostAt ?? 0);
			return b.id - a.id;
		});
		expect(first.items).toEqual(ordered);
		expect(first.items[0]).toEqual({ id: 300450, lastPostAt: 400450, digest: 3 });

		const call = captured(f, (sql) => sql.includes("t.digest > 0") && sql.includes("LIMIT"));
		expect(call.sql).toContain("FROM threads t INDEXED BY idx_threads_digest");
		expect(call.sql).not.toContain("threads_fts");
		const plan = explain(f, call.sql, call.params);
		expect(plan.some((row) => row.detail.includes("USING INDEX idx_threads_digest"))).toBe(true);
		expect(plan.some((row) => row.detail.includes("idx_threads_forum"))).toBe(false);
		expectItemsMatchUnhinted(f, call.sql, call.params);

		const last = first.items.at(-1);
		expect(last).toBeDefined();
		const next = await loadCatalogPage(f.env, {
			...sitewide,
			params: {
				...sitewide.params,
				cursorDigest: last?.digest ?? null,
				cursorTime: last?.lastPostAt ?? null,
				cursorId: last?.id ?? null,
			},
		});
		expect(next.items[0]?.id).not.toBe(first.items[0]?.id);
		const firstIds = new Set(first.items.map((row) => row.id));
		expect(next.items.every((row) => !firstIds.has(row.id))).toBe(true);
		const chained = [...first.items, ...next.items];
		const chainedOrder = [...chained].sort((a, b) => {
			if (a.digest !== b.digest) return (b.digest ?? 0) - (a.digest ?? 0);
			if (a.lastPostAt !== b.lastPostAt) return (b.lastPostAt ?? 0) - (a.lastPostAt ?? 0);
			return b.id - a.id;
		});
		expect(chained).toEqual(chainedOrder);
		const cursorCall = captured(f, (sql) => sql.includes("t.digest < ?"));
		expectItemsMatchUnhinted(f, cursorCall.sql, cursorCall.params);

		f.calls.length = 0;
		const level = await loadCatalogPage(f.env, {
			...sitewide,
			params: { ...sitewide.params, level: 1 },
		});
		expect(level.items.length).toBeGreaterThan(0);
		expect(level.items.every((row) => row.digest === 1)).toBe(true);
		const levelCall = captured(f, (sql) => sql.includes("t.digest = ?"));
		expect(levelCall.sql).toContain("INDEXED BY idx_threads_digest");
		expect(
			explain(f, levelCall.sql, levelCall.params).some((row) =>
				row.detail.includes("USING INDEX idx_threads_digest"),
			),
		).toBe(true);
		expectItemsMatchUnhinted(f, levelCall.sql, levelCall.params);

		const puts = vi.mocked(f.env.KV.put).mock.calls.length;
		expect(await rebuildCatalogCache(f.env, f.ctx, sitewide)).toEqual(first);
		expect(vi.mocked(f.env.KV.put).mock.calls).toHaveLength(puts);
	});

	it("uses digest subsets for per-forum and year filters", async () => {
		f.calls.length = 0;
		const forum = await loadCatalogPage(f.env, {
			...sitewide,
			params: { ...sitewide.params, forumId: 1 },
		});
		expect(forum.items.length).toBeGreaterThan(0);
		const forumSql = captured(f, (sql) => sql.includes("t.forum_id = ?")).sql;
		expect(forumSql).toContain("INDEXED BY idx_threads_forum_digest");

		f.calls.length = 0;
		const year = await loadCatalogPage(f.env, {
			...sitewide,
			params: { ...sitewide.params, year: 2024 },
		});
		expect(year.items.length).toBeGreaterThan(0);
		const yearSql = captured(f, (sql) => sql.includes("t.created_at >= ?")).sql;
		expect(yearSql).toContain("INDEXED BY idx_threads_digest");
		expect(yearSql).not.toContain("threads_fts");
	});
});
