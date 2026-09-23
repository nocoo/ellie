import { type CacheDescriptor, decodeGenericCursor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bumpThreadListGen, bumpThreadListGenAll } from "../../../../src/lib/cache/invalidate";
import {
	countLocalThreads,
	getThreadListPage,
	isThreadCursor,
	rebuildThreadListCache,
	type ThreadCursor,
	type ThreadListMember,
	type ThreadListQuery,
	threadListCacheKey,
} from "../../../../src/lib/cache/thread-list-read";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
type SqlCall = ReturnType<typeof readingFixture>["calls"][number];

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	for (let id = 1; id <= 100; id++) f.thread(id, { type_id: id % 2 ? 8 : 9 });
});

afterEach(() => {
	expect(f.calls.every((call) => call.params.length <= 100)).toBe(true);
	f.close();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

function query(overrides: Partial<ThreadListQuery> = {}): ThreadListQuery {
	return { forumId: 1, limit: 20, page: 1, cursor: null, typeId: null, ...overrides };
}

function localDescriptor(overrides: Partial<ThreadListQuery> = {}): CacheDescriptor {
	const q = query(overrides);
	return {
		family: "thread:list",
		scope: "internal",
		params: {
			kind: "local",
			forumId: q.forumId,
			typeId: q.typeId,
			limit: q.limit,
			offset: q.cursor ? 0 : (q.page - 1) * q.limit,
			cursorSticky: q.cursor?.sticky ?? null,
			cursorTime: q.cursor?.lastPostAt ?? null,
			cursorId: q.cursor?.id ?? null,
		},
	};
}

const announcementsDescriptor: CacheDescriptor = {
	family: "thread:list",
	scope: "internal",
	params: { kind: "announcements" },
};

function countCalls(): SqlCall[] {
	return f.calls.filter((call) => call.sql.includes("COUNT(*)"));
}

function membershipCall(): SqlCall {
	const call = f.calls.findLast(
		(item) => item.sql.includes("ORDER BY") && item.sql.includes("LIMIT"),
	);
	if (!call) throw new Error("The loader did not execute a membership query");
	return call;
}

function explain(call: SqlCall): string {
	return f.sqlite
		.prepare(`EXPLAIN QUERY PLAN ${call.sql}`)
		.all(...call.params)
		.map((row) => row.detail)
		.join("\n");
}

function seedHistory(): void {
	// Real schema/indexes, 30,000 historical rows, and tied timestamps.
	f.sqlite.exec(`WITH RECURSIVE historical(n) AS (
		SELECT 1 UNION ALL SELECT n + 1 FROM historical WHERE n < 30000
	) INSERT INTO threads (id, forum_id, author_id, author_name, subject, created_at,
		last_post_at, last_poster_id, last_poster, sticky, type_id)
	SELECT 10000 + n, 1, 10, 'alice', 'Historical', 1000 + n / 3,
		1000 + n / 3, 20, 'bob', 0, CASE WHEN n % 2 = 1 THEN 8 ELSE 9 END FROM historical`);
	f.thread(900, { sticky: 3, last_post_at: 5, type_id: 8 });
	f.thread(901, { sticky: 1, last_post_at: 4, type_id: 8 });
	f.thread(902, { sticky: 2, last_post_at: 2, type_id: 8 });
	f.thread(903, { sticky: 2, last_post_at: 2, type_id: 8 });
	f.thread(904, { forum_id: 2, sticky: 2, last_post_at: 3, type_id: 8 });
	f.thread(905, { forum_id: 3, sticky: 2, last_post_at: 99999, type_id: 8 });
	f.thread(906, { sticky: -2, last_post_at: 99999, type_id: 8 });
	f.thread(907, { forum_id: 2, sticky: 3, last_post_at: 99999, type_id: 8 });
}

describe("thread-list SQL plans and pagination", () => {
	// Coverage instrumentation and parallel suites add overhead to the 30,000-row fixtures.
	it("native ordinary order avoids a full CASE sort over historical rows", async () => {
		seedHistory();
		const data = await rebuildThreadListCache(f.env, undefined, localDescriptor());
		const captured = membershipCall();
		expect(captured.sql).toContain("ORDER BY t.sticky DESC, t.last_post_at DESC, t.id DESC");
		const plan = explain(captured);
		expect(plan).toContain("SEARCH t USING COVERING INDEX idx_threads_forum");
		// The existing index may sort the last id term within a timestamp tie.
		expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
		const previous = {
			...captured,
			sql: captured.sql.replace(
				"ORDER BY t.sticky DESC",
				"ORDER BY CASE WHEN t.sticky = 2 THEN 4 ELSE t.sticky END DESC",
			),
		};
		expect(explain(previous)).toContain("USE TEMP B-TREE FOR ORDER BY");
		expect(data).toEqual({ items: f.sqlite.prepare(previous.sql).all(...previous.params) });
		expect(f.calls).toHaveLength(1);
	}, 15_000);

	it("ordinary tuple cursors seek past earlier timestamp groups that the OR predicate scans", async () => {
		seedHistory();
		const cursor = { sticky: 0, lastPostAt: 2500, id: 14501 };
		const data = await rebuildThreadListCache(f.env, undefined, localDescriptor({ cursor }));
		const captured = membershipCall();
		const tuple = " AND (t.sticky, t.last_post_at, t.id) < (?, ?, ?)";
		expect(captured.sql).toContain(tuple);
		const previous = {
			...captured,
			sql: captured.sql.replace(
				tuple,
				" AND (t.sticky < ? OR (t.sticky = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))",
			),
			params: [
				1,
				cursor.sticky,
				cursor.sticky,
				cursor.lastPostAt,
				cursor.lastPostAt,
				cursor.id,
				20,
				0,
			],
		};
		expect(data).toEqual({ items: f.sqlite.prepare(previous.sql).all(...previous.params) });
		expect(explain(captured)).toContain("(sticky,last_post_at)<(?,?)");
		expect(explain(previous)).not.toContain("(sticky,last_post_at)");
		expect(explain(captured)).not.toContain("USE TEMP B-TREE FOR ORDER BY");
		const earlier = f.sqlite
			.prepare(`SELECT COUNT(*) AS total FROM threads
			WHERE forum_id = 1 AND sticky >= 0 AND sticky != 2 AND last_post_at > ?`)
			.get(2500);
		expect(earlier?.total).toBeGreaterThan(25_000);
	}, 15_000);

	it.each([null, 8, 9])(
		"preserves sticky ranks, offsets, cursor ties and totals for typeId=%s",
		async (typeId) => {
			seedHistory();
			const where =
				typeId === null ? "(t.forum_id = ? OR t.sticky = 2)" : "t.forum_id = ? AND t.type_id = ?";
			const expected: ThreadListMember[] = f.sqlite
				.prepare(`SELECT t.id, t.sticky, t.last_post_at FROM threads t
					JOIN forums f ON f.id = t.forum_id WHERE f.status = 1 AND ${where} AND t.sticky >= 0
					ORDER BY CASE WHEN t.sticky = 2 THEN 4 ELSE t.sticky END DESC, t.last_post_at DESC, t.id DESC`)
				.all(...(typeId === null ? [1] : [1, typeId]))
				.map((row) => ({
					id: Number(row.id),
					sticky: Number(row.sticky),
					last_post_at: Number(row.last_post_at),
				}));
			for (const limit of [1, 20, 100]) {
				for (const page of [1, 2, 99, 2000]) {
					const result = await getThreadListPage(f.env, undefined, query({ typeId, limit, page }));
					expect(result.items).toEqual(expected.slice((page - 1) * limit, page * limit));
					expect(result.total).toBe(expected.length);
				}
			}
			const cursors: ThreadCursor[] = [
				{ sticky: 4, lastPostAt: Number.MAX_SAFE_INTEGER, id: Number.MAX_SAFE_INTEGER },
				{ sticky: 4, lastPostAt: 2, id: 903 },
				{ sticky: 3, lastPostAt: 5, id: 900 },
				{ sticky: 2, lastPostAt: Number.MAX_SAFE_INTEGER, id: Number.MAX_SAFE_INTEGER },
				{ sticky: 1, lastPostAt: 4, id: 901 },
				{ sticky: 0, lastPostAt: 2500, id: 14501 },
				{ sticky: 0, lastPostAt: 0, id: 1 },
			];
			for (const cursor of cursors) {
				const after = expected.filter((row) => {
					const rank = row.sticky === 2 ? 4 : row.sticky;
					return (
						rank < cursor.sticky ||
						(rank === cursor.sticky &&
							(row.last_post_at < cursor.lastPostAt ||
								(row.last_post_at === cursor.lastPostAt && row.id < cursor.id)))
					);
				});
				const result = await getThreadListPage(
					f.env,
					undefined,
					query({ typeId, cursor, limit: 17 }),
				);
				expect(result.items).toEqual(after.slice(0, 17));
				expect(result.total).toBe(expected.length);
				const last = result.items.at(-1);
				expect(
					result.nextCursor
						? decodeGenericCursor<ThreadCursor>(result.nextCursor, isThreadCursor)
						: null,
				).toEqual(
					result.items.length === 17 && last
						? {
								sticky: last.sticky === 2 ? 4 : last.sticky,
								lastPostAt: last.last_post_at,
								id: last.id,
							}
						: null,
				);
			}
			expect(countCalls()).toHaveLength(3 * 4 + cursors.length);
			if (typeId !== null) {
				const captured = membershipCall();
				expect(captured.sql).toContain("CASE WHEN t.sticky = 2 THEN 4 ELSE t.sticky END");
				expect(captured.sql).toContain(" OR ");
				expect(explain(captured)).toContain("USE TEMP B-TREE FOR ORDER BY");
			}
		},
		15_000,
	);
});

describe("direct counts and cached membership budgets", () => {
	it.each([null, 8])(
		"reads each generation once per response and observes later bumps for typeId=%s",
		async (typeId) => {
			const generationGets = () =>
				vi
					.mocked(f.env.KV.get)
					.mock.calls.map(([key]) => key)
					.filter((key) => typeof key === "string" && key.startsWith("thread:list:gen:"));
			const initial = await getThreadListPage(f.env, undefined, query({ typeId }));
			expect(generationGets().sort()).toEqual(["thread:list:gen:1", "thread:list:gen:all"]);
			vi.mocked(f.env.KV.get).mockClear();
			f.calls.length = 0;
			expect(await getThreadListPage(f.env, undefined, query({ typeId }))).toEqual(initial);
			expect(generationGets().sort()).toEqual(["thread:list:gen:1", "thread:list:gen:all"]);
			expect(f.calls).toEqual(countCalls());
			expect(countCalls()).toHaveLength(1);
			f.thread(101, { type_id: 8 });
			await bumpThreadListGen(f.env, 1);
			vi.mocked(f.env.KV.get).mockClear();
			f.calls.length = 0;
			const changed = await getThreadListPage(f.env, undefined, query({ typeId }));
			expect(changed.total).toBe((initial.total ?? expect.fail("Missing total")) + 1);
			expect(changed.items[0].id).toBe(101);
			expect(generationGets().sort()).toEqual(["thread:list:gen:1", "thread:list:gen:all"]);
			expect(countCalls()).toHaveLength(1);
			await bumpThreadListGenAll(f.env);
			vi.mocked(f.env.KV.get).mockClear();
			f.calls.length = 0;
			expect(await getThreadListPage(f.env, undefined, query({ typeId }))).toEqual(changed);
			expect(generationGets().sort()).toEqual(["thread:list:gen:1", "thread:list:gen:all"]);
			expect(f.calls).toHaveLength(typeId === null ? 3 : 2);
		},
	);

	it("unavailable generations bypass every snapshot without filling an unavailable key", async () => {
		await getThreadListPage(f.env, undefined, query());
		const original = [...f.values];
		f.thread(101);
		f.state.readError = true;
		vi.mocked(f.env.KV.put).mockClear();
		const fresh = await getThreadListPage(f.env, undefined, query());
		expect(fresh.total).toBe(101);
		expect(fresh.items[0].id).toBe(101);
		expect([...f.values]).toEqual(original);
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});

	it("no-total cold and warm pages, filters and cursors never count", async () => {
		const queries = [
			query(),
			query({ page: 2 }),
			query({ limit: 100 }),
			query({ page: 3, limit: 25 }),
			query({ typeId: 8 }),
			query({ cursor: { sticky: 0, lastPostAt: 80, id: 80 } }),
		].map((q) => ({ ...q, includeTotal: false }));
		const pages = await Promise.all(queries.map((q) => getThreadListPage(f.env, undefined, q)));
		expect(pages.every((page) => page.total === null)).toBe(true);
		expect(pages.map((page) => page.hasNext)).toEqual([true, true, false, true, true, true]);
		expect(countCalls()).toHaveLength(0);
		f.calls.length = 0;
		expect(await Promise.all(queries.map((q) => getThreadListPage(f.env, undefined, q)))).toEqual(
			pages,
		);
		expect(f.calls).toHaveLength(0);
		vi.setSystemTime(Date.now() + 60_000);
		await getThreadListPage(f.env, undefined, queries[0]);
		expect(f.calls).toHaveLength(2);
		expect(countCalls()).toHaveLength(0);
		expect(f.snapshots("thread:count")).toEqual([]);
	});

	it("exact counts stay fresh without renewing cached minute membership", async () => {
		const startedAt = Date.now();
		const initial = await getThreadListPage(f.env, undefined, query({ limit: 25 }));
		const local = f.snapshots("thread:list").find((item) => item.params.kind === "local");
		expect(local.params.limit).toBe(26);
		const originalPage = f.values.get(local.key);
		f.thread(101);
		vi.setSystemTime(startedAt + 59_999);
		f.calls.length = 0;
		const warm = await getThreadListPage(f.env, undefined, query({ limit: 25 }));
		expect(warm).toEqual({ ...initial, total: 101 });
		expect(f.calls).toEqual(countCalls());
		expect(countCalls()).toHaveLength(1);
		expect(f.values.get(local.key)).toBe(originalPage);
		vi.setSystemTime(startedAt + 60_000);
		f.thread(102);
		f.calls.length = 0;
		const refreshed = await getThreadListPage(f.env, undefined, query({ limit: 25 }));
		expect(refreshed.items[0].id).toBe(102);
		expect(refreshed.total).toBe(102);
		expect(countCalls()).toHaveLength(1);
		expect(f.calls.filter((call) => call.sql.includes("LIMIT"))).toHaveLength(1);
		for (const snapshot of f.snapshots("thread:list")) {
			expect(snapshot.tier).toBe("SHORT");
			expect(snapshot.scope).toBe("internal");
			expect(snapshot.expiresAt - snapshot.loadedAt).toBe(60_000);
			if (snapshot.params.kind === "local") expect(Object.keys(snapshot.data)).toEqual(["items"]);
		}
		expect(f.snapshots("thread:count")).toEqual([]);
	});

	it("membership keys retain canonical params and forum/global invalidation", async () => {
		await getThreadListPage(f.env, undefined, query());
		await getThreadListPage(f.env, undefined, query({ typeId: 8 }));
		await getThreadListPage(f.env, undefined, query({ forumId: 2 }));
		const descriptor = localDescriptor();
		expect(
			await threadListCacheKey(f.env, {
				...descriptor,
				params: Object.fromEntries(Object.entries(descriptor.params).reverse()),
			}),
		).toBe(await threadListCacheKey(f.env, descriptor));
		const snapshots = f.snapshots("thread:list");
		f.calls.length = 0;
		for (const snapshot of snapshots)
			expect(await threadListCacheKey(f.env, snapshot)).toBe(snapshot.key);
		await bumpThreadListGen(f.env, 1);
		const forumKeys = [];
		for (const snapshot of snapshots) {
			const key = await threadListCacheKey(f.env, snapshot);
			expect(key === snapshot.key).toBe(snapshot.params.forumId !== 1);
			forumKeys.push(key);
		}
		await bumpThreadListGenAll(f.env);
		for (const [i, snapshot] of snapshots.entries())
			expect(await threadListCacheKey(f.env, snapshot)).not.toBe(forumKeys[i]);
		expect(f.calls).toHaveLength(0);
	});

	it("direct counts, rebuilds and fresh reads have no KV or business side effects", async () => {
		await getThreadListPage(f.env, undefined, query());
		const snapshots = [...f.values];
		f.thread(101);
		f.thread(901, { forum_id: 2, sticky: 2, last_post_at: 999 });
		f.calls.length = 0;
		vi.mocked(f.env.KV.get).mockClear();
		vi.mocked(f.env.KV.put).mockClear();
		expect(await countLocalThreads(f.env, 1, null)).toBe(101);
		const local = await rebuildThreadListCache(f.env, f.ctx, localDescriptor());
		expect(local).toMatchObject({
			items: [expect.objectContaining({ id: 101 }), ...Array(19).fill(expect.any(Object))],
		});
		expect(Object.keys(local)).toEqual(["items"]);
		expect(await rebuildThreadListCache(f.env, f.ctx, announcementsDescriptor)).toEqual({
			items: [{ id: 901, sticky: 2, last_post_at: 999 }],
			total: 1,
		});
		const page = await getThreadListPage(f.env, f.ctx, query(), true);
		expect(page.total).toBe(102);
		expect(page.items.slice(0, 2).map((item) => item.id)).toEqual([901, 101]);
		expect(f.calls).toHaveLength(6);
		expect(f.calls.every((call) => /^SELECT\b/.test(call.sql))).toBe(true);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
		expect(f.env.KV.delete).not.toHaveBeenCalled();
		expect(f.ctx._waitUntilPromises).toHaveLength(0);
		expect([...f.values]).toEqual(snapshots);
	});

	it("old combined pages reload membership, and failed counts never become zero", async () => {
		await getThreadListPage(f.env, undefined, query());
		const local = f.snapshots("thread:list").find((item) => item.params.kind === "local");
		f.values.set(local.key, JSON.stringify({ ...local, data: { ...local.data, total: 1 } }));
		f.calls.length = 0;
		expect((await getThreadListPage(f.env, undefined, query())).total).toBe(100);
		expect(f.calls).toHaveLength(2);
		expect(countCalls()).toHaveLength(1);
		expect(JSON.parse(f.values.get(local.key) ?? "null").data).not.toHaveProperty("total");
		f.state.afterRead = async (sql) => {
			if (sql.includes("COUNT(*)")) throw new Error("count query failed");
		};
		await expect(getThreadListPage(f.env, undefined, query())).rejects.toThrow(
			"count query failed",
		);
		f.state.afterRead = undefined;
		expect((await getThreadListPage(f.env, undefined, query())).total).toBe(100);
	});

	it("missing and malformed authoritative counts throw; empty counts remain zero", async () => {
		const prepare = f.env.DB.prepare.bind(f.env.DB);
		const spy = vi.spyOn(f.env.DB, "prepare");
		for (const expression of ["NULL", "'100'", "-1", "0.5", "9007199254740992.0"]) {
			spy.mockImplementation((sql) =>
				prepare(sql.replace(/COUNT\(\*\) AS total/i, `MAX(${expression}) AS total`)),
			);
			await expect(countLocalThreads(f.env, 1, null)).rejects.toThrow();
		}
		spy.mockImplementation((sql) => prepare(`${sql} HAVING COUNT(*) < 0`));
		await expect(countLocalThreads(f.env, 1, null)).rejects.toThrow();
		spy.mockRestore();
		f.state.queryError = true;
		for (const descriptor of [localDescriptor(), announcementsDescriptor])
			await expect(rebuildThreadListCache(f.env, undefined, descriptor)).rejects.toThrow();
		f.state.queryError = false;
		expect(await countLocalThreads(f.env, 2, null)).toBe(0);
		f.thread(201, { sticky: 2, type_id: 8 });
		f.thread(202, { sticky: -1, type_id: 8 });
		expect(await countLocalThreads(f.env, 1, null)).toBe(100);
		expect(await countLocalThreads(f.env, 1, 8)).toBe(51);
		expect(await countLocalThreads(f.env, 1, 9)).toBe(50);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});
});

it("cursor reads never load totals, including expired snapshots", async () => {
	const first = await getThreadListPage(f.env, undefined, query({ includeTotal: false }));
	expect(first.total).toBeNull();
	expect(countCalls()).toHaveLength(0);
	const cursor = decodeGenericCursor<ThreadCursor>(
		first.nextCursor ?? expect.fail("Missing next cursor"),
		isThreadCursor,
	);
	vi.setSystemTime(Date.now() + 61000);
	await getThreadListPage(f.env, undefined, query({ cursor, includeTotal: false }), true);
	expect(countCalls()).toHaveLength(0);
	expect(f.snapshots("thread:count")).toEqual([]);
	const page = await getThreadListPage(f.env, undefined, query());
	expect(page.total).toBe(100);
	expect(countCalls()).toHaveLength(1);
});
