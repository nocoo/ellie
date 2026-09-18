import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as digest from "../../../src/handlers/digest";
import { __resetMetricsForTest } from "../../../src/lib/cache/metrics";
import { createJwtForRole } from "../../helpers";
import { readingFixture } from "../lib/cache/thread-cache-fixture";

describe("digest handlers", () => {
	let f: ReturnType<typeof readingFixture>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_700_000_000_000);
		__resetMetricsForTest();
		f = readingFixture();
	});

	afterEach(() => {
		f.close();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("serves stats and filters with a deleted forum-zero group and rechecks visibility on hits", async () => {
		f.insert("forums", { id: 0, name: "Deleted forum", status: -1 });
		f.thread(1, { forum_id: 0, digest: 1, created_at: 1_104_537_600 });
		f.thread(2, { forum_id: 1, digest: 2, created_at: 1_711_540_800 });
		f.thread(3, { forum_id: 2, digest: 3, created_at: 1_680_000_000 });
		const statsRequest = new Request("https://api.example.com/api/v1/digest/stats");
		const filtersRequest = new Request("https://api.example.com/api/v1/digest/filters");

		const stats = await digest.stats(statsRequest, f.env);
		const filters = await digest.filters(filtersRequest, f.env);
		expect(stats.status).toBe(200);
		expect(filters.status).toBe(200);
		expect((await stats.json()).data).toEqual({ total: 1, level1: 0, level2: 1, level3: 0 });
		expect((await filters.json()).data).toEqual({
			years: [2024],
			forums: [{ id: 1, name: "Public", digestCount: 1 }],
		});
		const snapshots = [...f.snapshots("digest:stats"), ...f.snapshots("digest:filters")];
		expect(snapshots).toHaveLength(1);
		const aggregateQueries = () =>
			f.calls.filter((call) => call.sql.includes("GROUP BY t.forum_id"));
		expect(aggregateQueries()).toHaveLength(1);

		f.sqlite.exec("UPDATE forums SET status = 0 WHERE id = 1");
		expect((await (await digest.stats(statsRequest, f.env)).json()).data).toEqual({
			total: 0,
			level1: 0,
			level2: 0,
			level3: 0,
		});
		expect((await (await digest.filters(filtersRequest, f.env)).json()).data).toEqual({
			years: [],
			forums: [],
		});
		expect(aggregateQueries()).toHaveLength(1);
		expect([...f.snapshots("digest:stats"), ...f.snapshots("digest:filters")]).toEqual(snapshots);
	});

	describe("list", () => {
		it("should return empty list when no digest threads exist with SHORT cache tier", async () => {
			const request = new Request("https://api.example.com/api/v1/digest");
			const response = await digest.list(request, f.env, f.ctx);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: unknown[];
				meta: { nextCursor: string | null };
			};
			expect(body.data).toEqual([]);
			expect(body.meta.nextCursor).toBeNull();
		});

		it("should return digest threads with next cursor when page is full", async () => {
			for (let i = 1; i <= 25; i++) {
				f.thread(i, {
					forum_id: 1,
					digest: 1,
					created_at: 1711540800 + i,
					last_post_at: 1711544400 + i,
				});
			}

			const request = new Request("https://api.example.com/api/v1/digest?limit=20");
			const response = await digest.list(request, f.env, f.ctx);
			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				data: { id: number }[];
				meta: { nextCursor: string | null };
			};
			expect(body.data).toHaveLength(20);
			expect(body.meta.nextCursor).not.toBeNull();
		});

		it("should support cursor-based pagination across pages", async () => {
			for (let i = 1; i <= 3; i++) {
				f.thread(i, {
					forum_id: 1,
					digest: 1,
					created_at: 1711540800 + i,
					last_post_at: 1711544400 + i,
				});
			}

			// Page 1 with limit 2
			const res1 = await digest.list(
				new Request("https://api.example.com/api/v1/digest?limit=2"),
				f.env,
				f.ctx,
			);
			const body1 = (await res1.json()) as { data: { id: number }[]; meta: { nextCursor: string } };
			expect(body1.data).toHaveLength(2);
			expect(body1.meta.nextCursor).not.toBeNull();

			// Page 2 using cursor
			const res2 = await digest.list(
				new Request(
					`https://api.example.com/api/v1/digest?limit=2&cursor=${encodeURIComponent(body1.meta.nextCursor)}`,
				),
				f.env,
				f.ctx,
			);
			const body2 = (await res2.json()) as {
				data: { id: number }[];
				meta: { nextCursor: string | null };
			};
			expect(body2.data).toHaveLength(1);
			expect(body2.meta.nextCursor).toBeNull();
		});

		it("should filter by forumId and level", async () => {
			f.thread(1, { forum_id: 1, digest: 1 });
			f.thread(2, { forum_id: 1, digest: 2 });

			const res = await digest.list(
				new Request("https://api.example.com/api/v1/digest?forumId=1&level=2"),
				f.env,
				f.ctx,
			);
			const body = (await res.json()) as { data: { id: number; digest: number }[] };
			expect(body.data).toHaveLength(1);
			expect(body.data[0].id).toBe(2);
			expect(body.data[0].digest).toBe(2);
		});

		it("composes current forum visibility gate on hot cache hits", async () => {
			// forum 2 is staff-only
			f.thread(10, { forum_id: 2, digest: 1 });

			// Anonymous caller: cannot view staff forum
			const anonRes = await digest.list(
				new Request("https://api.example.com/api/v1/digest"),
				f.env,
				f.ctx,
			);
			const anonBody = (await anonRes.json()) as { data: unknown[] };
			expect(anonBody.data).toHaveLength(0);

			// Staff caller (mod30 role=3): can view staff forum
			const token = await createJwtForRole(3, 30, f.env.JWT_SECRET);
			const staffReq = new Request("https://api.example.com/api/v1/digest", {
				headers: { Authorization: `Bearer ${token}` },
			});
			const staffRes = await digest.list(staffReq, f.env, f.ctx);
			const staffBody = (await staffRes.json()) as { data: { id: number }[] };
			expect(staffBody.data).toHaveLength(1);
			expect(staffBody.data[0].id).toBe(10);
		});
	});

	describe("stats", () => {
		it("should calculate correct totals across digest levels", async () => {
			f.thread(1, { forum_id: 1, digest: 1 });
			f.thread(2, { forum_id: 1, digest: 2 });
			f.thread(3, { forum_id: 1, digest: 3 });

			const res = await digest.stats(
				new Request("https://api.example.com/api/v1/digest/stats"),
				f.env,
				f.ctx,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data: { total: number; level1: number; level2: number; level3: number };
			};
			expect(body.data).toEqual({
				total: 3,
				level1: 1,
				level2: 1,
				level3: 1,
			});
		});

		it("excludes private forums from stats for non-staff viewers", async () => {
			f.thread(1, { forum_id: 1, digest: 1 }); // public forum
			f.thread(2, { forum_id: 2, digest: 1 }); // staff forum

			const anonRes = await digest.stats(
				new Request("https://api.example.com/api/v1/digest/stats"),
				f.env,
				f.ctx,
			);
			const anonBody = (await anonRes.json()) as { data: { total: number } };
			expect(anonBody.data.total).toBe(1);

			const token = await createJwtForRole(3, 30, f.env.JWT_SECRET);
			const staffRes = await digest.stats(
				new Request("https://api.example.com/api/v1/digest/stats", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				f.env,
				f.ctx,
			);
			const staffBody = (await staffRes.json()) as { data: { total: number } };
			expect(staffBody.data.total).toBe(2);
		});
	});

	describe("filters", () => {
		it("returns unique years and per-forum digest counts", async () => {
			f.thread(1, { forum_id: 1, digest: 1, created_at: 1711540800 }); // 2024
			f.thread(2, { forum_id: 1, digest: 2, created_at: 1680000000 }); // 2023

			const res = await digest.filters(
				new Request("https://api.example.com/api/v1/digest/filters"),
				f.env,
				f.ctx,
			);
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				data: { years: number[]; forums: { id: number; name: string; digestCount: number }[] };
			};
			expect(body.data.years).toContain(2024);
			expect(body.data.years).toContain(2023);
			expect(body.data.forums).toHaveLength(1);
			expect(body.data.forums[0].id).toBe(1);
			expect(body.data.forums[0].digestCount).toBe(2);
		});
	});
});
