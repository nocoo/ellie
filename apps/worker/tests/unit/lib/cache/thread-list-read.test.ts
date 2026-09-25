import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getThreadListPage,
	isThreadListCacheData,
	rebuildThreadListCache,
	type ThreadListQuery,
} from "../../../../src/lib/cache/thread-list-read";
import {
	recordStatisticsDelta,
	refreshDailyStatistics,
} from "../../../../src/lib/daily-statistics";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;
beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-09-17T00:00:00Z"));
	f = readingFixture();
	for (let id = 1; id <= 180; id++)
		f.thread(id, { sticky: id === 179 ? 3 : id === 178 ? 1 : 0, type_id: id % 2 ? 8 : 9 });
	f.thread(901, { forum_id: 2, sticky: 2, last_post_at: 900 });
	f.thread(902, { forum_id: 2, sticky: 2, last_post_at: 901 });
	f.thread(903, { forum_id: 2, sticky: 2, last_post_at: 902 });
	await refreshDailyStatistics(f.env);
	f.calls.length = 0;
	vi.mocked(f.env.KV.get).mockClear();
	vi.mocked(f.env.KV.put).mockClear();
});
afterEach(() => {
	f.close();
	vi.useRealTimers();
});

function query(overrides: Partial<ThreadListQuery> = {}): ThreadListQuery {
	return { forumId: 1, limit: 20, page: 1, cursor: null, typeId: null, ...overrides };
}

describe("all thread-list memberships", () => {
	it("uses optimistic snapshot counts while membership retains its minute lifetime", async () => {
		const start = Date.now();
		const initial = await getThreadListPage(f.env, undefined, query());
		expect(initial.total).toBe(183);
		const membership = f.snapshots("thread:list");
		f.thread(999, { last_post_at: 9999 });
		await recordStatisticsDelta(f.env, { kind: "thread", forumId: 1 });
		f.calls.length = 0;
		const warm = await getThreadListPage(f.env, undefined, query());
		expect(warm.items).toEqual(initial.items);
		expect(warm.total).toBe(184);
		expect(f.calls).toHaveLength(0);
		expect(f.snapshots("thread:list")).toEqual(membership);
		vi.setSystemTime(start + 60_000);
		f.calls.length = 0;
		const updated = await getThreadListPage(f.env, undefined, query());
		expect(updated.items.some((item) => item.id === 999)).toBe(true);
		expect(updated.total).toBe(184);
		expect(f.calls.filter((call) => call.sql.includes("COUNT(*)"))).toHaveLength(0);
		expect(f.snapshots("thread:count")).toEqual([]);
	});
	it.each([1, 2, 17, 20, 25, 50, 99, 100])(
		"caches first/deep pages at legal limit %i with original ordering",
		async (limit) => {
			const expected = f.sqlite
				.prepare(`SELECT id FROM threads t WHERE (forum_id = 1 OR sticky = 2) AND sticky >= 0
			ORDER BY CASE WHEN sticky = 2 THEN 4 ELSE sticky END DESC, last_post_at DESC, id DESC`)
				.all()
				.map((row) => Number(row.id));
			for (const page of [1, 2, 3, 30]) {
				const params = query({ page, limit });
				const result = await getThreadListPage(f.env, undefined, params);
				expect(result.items.map((row) => row.id)).toEqual(
					expected.slice((page - 1) * limit, page * limit),
				);
				expect(result.total).toBe(183);
				f.calls.length = 0;
				expect(await getThreadListPage(f.env, undefined, params)).toEqual(result);
				expect(f.calls).toHaveLength(0);
			}
		},
	);

	it("keyset walks across announcement/local rank boundaries without gaps or duplicate IDs", async () => {
		const all: number[] = [];
		let cursor: ThreadListQuery["cursor"] = null;
		for (let i = 0; i < 95; i++) {
			const params = query({ limit: 2, cursor, includeTotal: false });
			const result = await getThreadListPage(f.env, undefined, params);
			all.push(...result.items.map((row) => row.id));
			if (!result.nextCursor) break;
			const last = result.items.at(-1);
			if (!last) throw new Error("A next cursor requires a page member");
			cursor = {
				sticky: last.sticky === 2 ? 4 : last.sticky,
				lastPostAt: last.last_post_at,
				id: last.id,
			};
			f.calls.length = 0;
			await getThreadListPage(f.env, undefined, params);
			expect(f.calls).toHaveLength(0);
		}
		expect(all).toHaveLength(183);
		expect(new Set(all).size).toBe(183);
		expect(all.slice(0, 5)).toEqual([903, 902, 901, 179, 178]);
	});

	it("keeps type filters, limits and forums distinct and reuses global IDs once", async () => {
		const first = await getThreadListPage(f.env, undefined, query({ typeId: 8, limit: 17 }));
		const second = await getThreadListPage(f.env, undefined, query({ typeId: 9, limit: 17 }));
		expect(first.items.every((item) => item.id % 2 === 1 && item.id < 900)).toBe(true);
		expect(second.items.every((item) => item.id % 2 === 0 && item.id < 900)).toBe(true);
		expect(first.total).toBe(90);
		expect(second.total).toBe(90);
		await getThreadListPage(f.env, undefined, query());
		await getThreadListPage(f.env, undefined, query({ forumId: 2 }));
		expect(
			f.snapshots("thread:list").filter((item) => item.params.kind === "announcements"),
		).toHaveLength(1);
		for (const item of f.snapshots("thread:list")) {
			expect(item.tier).toBe("SHORT");
			expect(item.scope).toBe("internal");
			expect(JSON.stringify(item.data)).not.toMatch(/subject|author_name|avatar|views|replies/);
			if (item.params.kind === "local") expect(Object.keys(item.data)).toEqual(["items"]);
			expect(item.params.kind).not.toBe("count");
		}
	});

	it("first-page forms share a key and SHORT expiry stays fixed across hits", async () => {
		await getThreadListPage(f.env, undefined, query());
		const original = f.snapshots("thread:list");
		vi.setSystemTime(Date.now() + 59_999);
		f.calls.length = 0;
		await getThreadListPage(f.env, undefined, query({ page: 1 }));
		expect(f.calls).toHaveLength(0);
		expect(f.snapshots("thread:list")).toEqual(original);
		f.calls.length = 0;
		vi.setSystemTime(Date.now() + 1);
		await getThreadListPage(f.env, undefined, query());
		expect(f.calls).toHaveLength(2);
		expect(f.calls.filter((call) => call.sql.includes("COUNT(*)"))).toHaveLength(0);
	});

	it("rebuild rejects injected parameters and has no KV I/O", async () => {
		const descriptor = {
			family: "thread:list",
			scope: "internal",
			params: {
				kind: "local",
				forumId: 1,
				typeId: null,
				limit: 20,
				offset: 20,
				cursorSticky: null,
				cursorTime: null,
				cursorId: null,
			},
		};
		const membership = await rebuildThreadListCache(f.env, undefined, descriptor);
		if (!("items" in membership)) throw new Error("Expected a local membership snapshot");
		expect(membership.items).toHaveLength(20);
		expect(Object.keys(membership)).toEqual(["items"]);
		expect(f.calls).toHaveLength(1);
		expect(isThreadListCacheData(descriptor, membership)).toBe(true);
		expect(isThreadListCacheData(descriptor, { ...membership, total: 180 })).toBe(false);
		expect(
			isThreadListCacheData(
				{ ...descriptor, params: { ...descriptor.params, limit: 1 } },
				membership,
			),
		).toBe(false);
		expect(
			isThreadListCacheData(descriptor, {
				...membership,
				items: [membership.items[0], membership.items[0]],
			}),
		).toBe(false);
		expect(f.values.size).toBe(1);
		f.calls.length = 0;
		for (const params of [
			{ ...descriptor.params, limit: "20 OFFSET 0" },
			{ ...descriptor.params, limit: 102 },
			{ ...descriptor.params, offset: -1 },
			{ ...descriptor.params, cursorSticky: 3 },
		]) {
			await expect(
				rebuildThreadListCache(f.env, undefined, { ...descriptor, params }),
			).rejects.toThrow();
		}
		expect(f.calls).toHaveLength(0);
	});

	it("retired count descriptors are rejected before D1 or KV access", async () => {
		const descriptor = {
			family: "thread:count",
			scope: "internal",
			params: { kind: "count", forumId: 1, typeId: null },
		};
		expect(isThreadListCacheData(descriptor, { total: 180 })).toBe(false);
		await expect(rebuildThreadListCache(f.env, undefined, descriptor)).rejects.toThrow(
			"Unsupported thread-list cache descriptor",
		);
		expect(f.calls).toHaveLength(0);
		expect(f.env.KV.get).not.toHaveBeenCalled();
		expect(f.env.KV.put).not.toHaveBeenCalled();
	});
});
