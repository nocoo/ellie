import type { CacheDescriptor } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipLookupCacheKey } from "../../../../src/handlers/admin/ip-lookup";
import { adminEntityCacheKey, readAdminEntity } from "../../../../src/lib/cache/admin-entity-read";
import { monitorCacheKey } from "../../../../src/lib/cache/admin-monitor-read";
import { adminReportCacheKey, getAdminReport } from "../../../../src/lib/cache/admin-report-read";
import {
	catalogCacheKey,
	getCachedThreadTypes,
	getDigestGroups,
} from "../../../../src/lib/cache/catalog-read";
import {
	forumCacheKey,
	getForumSummaryV2,
	getForumTreeV2,
} from "../../../../src/lib/cache/forum-read";
import {
	deleteCacheEntry,
	inspectCacheEntry,
	rebuildCacheEntry,
} from "../../../../src/lib/cache/manage";
import { __resetMetricsForTest, swapSnapshot } from "../../../../src/lib/cache/metrics";
import {
	getMessages,
	getUnreadCount,
	type MessageRow,
	privateCacheKey,
} from "../../../../src/lib/cache/private-read";
import { getThreadListPage } from "../../../../src/lib/cache/thread-list-read";
import {
	cacheGetOrSet,
	createCacheEnvelope,
	putCacheEnvelope,
} from "../../../../src/lib/cache/wrap";
import { readingFixture } from "./thread-cache-fixture";

let f: ReturnType<typeof readingFixture>;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(1_700_000_000_000);
	__resetMetricsForTest();
	f = readingFixture();
	f.thread(1);
	f.post(1);
});

afterEach(() => {
	f.close();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("manage-dispatch — static manager key/load/validator dispatch per loader group", () => {
	it("inspects, rebuilds and deletes thread-list counts independently of page snapshots", async () => {
		await getThreadListPage(f.env, undefined, {
			forumId: 1,
			typeId: null,
			page: 1,
			limit: 20,
			cursor: null,
		});
		const page = f.snapshots("thread:list").find((entry) => entry.params.kind === "local");
		const count = f.snapshots("thread:list").find((entry) => entry.params.kind === "count");
		expect(page).toBeDefined();
		expect(count).toBeDefined();
		const countBefore = f.values.get(count.key);
		f.calls.length = 0;
		__resetMetricsForTest();
		for (const entry of [page, count]) {
			const inspected = await inspectCacheEntry(f.env, entry.key);
			expect(inspected.valid).toBe(true);
			expect(inspected.envelope).toMatchObject({ tier: "SHORT", scope: "internal" });
			expect(entry.expiresAt - entry.loadedAt).toBe(60_000);
		}
		expect(f.calls).toHaveLength(0);

		vi.setSystemTime(Date.now() + 30_000);
		f.thread(2);
		const rebuiltPage = await rebuildCacheEntry(f.env, undefined, page.key);
		expect(rebuiltPage.data).toEqual({
			items: [
				{ id: 2, sticky: 0, last_post_at: 2 },
				{ id: 1, sticky: 0, last_post_at: 1 },
			],
		});
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).not.toMatch(/COUNT\s*\(/i);
		expect(f.values.get(count.key)).toBe(countBefore);
		const pageAfter = f.values.get(page.key);

		f.calls.length = 0;
		const rebuiltCount = await rebuildCacheEntry(f.env, undefined, count.key);
		expect(rebuiltCount.data).toEqual({ total: 2 });
		expect(rebuiltCount.tier).toBe("SHORT");
		expect(rebuiltCount.expiresAt - rebuiltCount.loadedAt).toBe(60_000);
		expect(f.calls).toHaveLength(1);
		expect(f.calls[0].sql).toMatch(/COUNT\s*\(/i);
		expect(f.values.get(page.key)).toBe(pageAfter);
		expect(f.calls.every((call) => /^\s*SELECT\b/i.test(call.sql))).toBe(true);
		expect([...swapSnapshot().keys()].some((key) => key.startsWith("thread:list\u0001"))).toBe(
			false,
		);

		f.calls.length = 0;
		const otherEntries = new Map([...f.values].filter(([key]) => key !== count.key));
		await deleteCacheEntry(f.env, count.key);
		expect(f.calls).toHaveLength(0);
		expect(f.values.has(count.key)).toBe(false);
		expect(f.values).toEqual(otherEntries);
	});

	it("dispatches forum loader (forum:tree:v2 and forum:summary:v2)", async () => {
		// Seed forum:tree:v2
		await getForumTreeV2(f.env, undefined, "anon");
		const treeDesc: CacheDescriptor = {
			family: "forum:tree:v2",
			params: { bucket: "anon" },
			scope: "role:anon",
		};
		const treeKey = await forumCacheKey(f.env, treeDesc);

		// Inspect forum tree: does not hit D1
		f.calls.length = 0;
		const inspectedTree = await inspectCacheEntry(f.env, treeKey);
		expect(inspectedTree.found).toBe(true);
		expect(inspectedTree.valid).toBe(true);
		expect(f.calls).toHaveLength(0);

		// Rebuild forum tree
		f.sqlite.prepare("UPDATE forums SET name = 'Public Forum Updated' WHERE id = 1").run();
		const rebuiltTree = await rebuildCacheEntry(f.env, undefined, treeKey);
		expect(rebuiltTree.tier).toBe("LONG");
		expect(rebuiltTree.scope).toBe("role:anon");
		expect(
			(rebuiltTree.data as { forums: { name: string }[] }).forums.some(
				(m) => m.name === "Public Forum Updated",
			),
		).toBe(true);

		// Seed forum:summary:v2
		await getForumSummaryV2(f.env, undefined, "anon");
		const summaryDesc: CacheDescriptor = {
			family: "forum:summary:v2",
			params: { bucket: "anon" },
			scope: "role:anon",
		};
		const summaryKey = await forumCacheKey(f.env, summaryDesc);

		const inspectedSummary = await inspectCacheEntry(f.env, summaryKey);
		expect(inspectedSummary.found).toBe(true);
		expect(inspectedSummary.valid).toBe(true);

		const rebuiltSummary = await rebuildCacheEntry(f.env, undefined, summaryKey);
		expect(rebuiltSummary.tier).toBe("MEDIUM");
		expect(rebuiltSummary.scope).toBe("role:anon");
	});

	it("dispatches catalog loader (thread-types, digest:stats)", async () => {
		// Populate thread types in forum 1
		f.sqlite
			.prepare(
				"UPDATE forums SET thread_types_enabled = 1, thread_types_required = 1, thread_types_listable = 1, thread_types_prefix = 1 WHERE id = 1",
			)
			.run();
		f.sqlite
			.prepare(
				"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, enabled, moderator_only) VALUES (1, 1, 10, 'Discussion', 1, 1, 0)",
			)
			.run();

		await getCachedThreadTypes(f.env, undefined, 1);
		const ttDesc: CacheDescriptor = {
			family: "thread-types",
			params: { forumId: 1 },
			scope: "internal",
		};
		const ttKey = await catalogCacheKey(f.env, ttDesc);

		// Inspect thread-types does zero D1 calls
		f.calls.length = 0;
		const inspectedTt = await inspectCacheEntry(f.env, ttKey);
		expect(inspectedTt.found).toBe(true);
		expect(inspectedTt.valid).toBe(true);
		expect(f.calls).toHaveLength(0);

		// Rebuild thread types
		f.sqlite
			.prepare("UPDATE forum_thread_types SET name = 'Discussion Updated' WHERE id = 1")
			.run();
		const rebuiltTt = await rebuildCacheEntry(f.env, undefined, ttKey);
		expect(rebuiltTt.tier).toBe("LONG");
		expect(rebuiltTt.scope).toBe("internal");
		expect((rebuiltTt.data as { types: { name: string }[] }).types[0].name).toBe(
			"Discussion Updated",
		);

		// Seed digest:stats (seed with at least 1 digest thread so it's not downgraded to SHORT)
		f.thread(10, { forum_id: 1, digest: 1 });
		await getDigestGroups(f.env, undefined, "digest:stats");
		const digestDesc: CacheDescriptor = { family: "digest:stats", params: {}, scope: "internal" };
		const digestKey = await catalogCacheKey(f.env, digestDesc);

		const rebuiltDigest = await rebuildCacheEntry(f.env, undefined, digestKey);
		expect(rebuiltDigest.tier).toBe("MEDIUM");
		expect(rebuiltDigest.scope).toBe("internal");
	});

	it("dispatches private loader (user:self, pm:unread, pm:entity) with strict user scope", async () => {
		// Insert messages in DB
		f.insert("messages", {
			id: 101,
			sender_id: 10,
			sender_name: "alice",
			receiver_id: 20,
			receiver_name: "bob",
			subject: "Hello Bob",
			content: "Message body",
			is_read: 0,
			sender_deleted: 0,
			receiver_deleted: 0,
			created_at: 1_700_000_000,
		});

		// Seed pm:unread for user 20
		await getUnreadCount(f.env, undefined, 20);
		const unreadDesc: CacheDescriptor = {
			family: "pm:unread",
			params: { userId: 20 },
			scope: "user:20",
		};
		const unreadKey = await privateCacheKey(f.env, unreadDesc);

		const inspectedUnread = await inspectCacheEntry(f.env, unreadKey);
		expect(inspectedUnread.found).toBe(true);
		expect(inspectedUnread.valid).toBe(true);

		// Rebuild pm:unread
		const rebuiltUnread = await rebuildCacheEntry(f.env, undefined, unreadKey);
		expect(rebuiltUnread.tier).toBe("SHORT");
		expect(rebuiltUnread.scope).toBe("user:20");
		expect((rebuiltUnread.data as { count: number }).count).toBe(1);

		// Seed pm:entity for user 20 (receiver)
		const msgMap = await getMessages(f.env, undefined, 20, [101]);
		expect(msgMap.get(101)?.subject).toBe("Hello Bob");

		const entityDesc: CacheDescriptor = {
			family: "pm:entity",
			params: { userId: 20, id: 101 },
			scope: "user:20",
		};
		const entityKey = await privateCacheKey(f.env, entityDesc);

		// Rebuild pm:entity
		f.sqlite.prepare("UPDATE messages SET subject = 'Hello Bob Revised' WHERE id = 101").run();
		const rebuiltEntity = await rebuildCacheEntry(f.env, undefined, entityKey);
		expect(rebuiltEntity.tier).toBe("SHORT");
		expect(rebuiltEntity.scope).toBe("user:20");
		expect((rebuiltEntity.data as MessageRow).subject).toBe("Hello Bob Revised");

		// User 30 cannot read or rebuild user 20's PM entity
		const hijackedDesc: CacheDescriptor = {
			family: "pm:entity",
			params: { userId: 30, id: 101 },
			scope: "user:30",
		};
		const hijackedKey = await privateCacheKey(f.env, hijackedDesc);
		await putCacheEnvelope(
			f.env,
			hijackedKey,
			createCacheEnvelope(null, { ...hijackedDesc, tier: "SHORT" }),
		);
		// Rebuilding for user 30 returns null (negative cache), never leaks content
		const rebuiltHijacked = await rebuildCacheEntry(f.env, undefined, hijackedKey);
		expect(rebuiltHijacked.data).toBeNull();
	});

	it("dispatches admin entity loader (list, detail, custom settings, staff, thread-types)", async () => {
		// Admin detail: users
		const detailDesc: CacheDescriptor = {
			family: "admin:entity:detail",
			params: { entity: "users", id: 10 },
			scope: "admin",
		};
		await readAdminEntity(f.env, undefined, detailDesc);
		const detailKey = await adminEntityCacheKey(f.env, detailDesc);

		f.sqlite.prepare("UPDATE users SET username = 'alice_renamed' WHERE id = 10").run();
		const rebuiltDetail = await rebuildCacheEntry(f.env, undefined, detailKey);
		expect(rebuiltDetail.tier).toBe("SHORT");
		expect(rebuiltDetail.scope).toBe("admin");
		expect((rebuiltDetail.data as { username: string }).username).toBe("alice_renamed");

		// Admin list: users
		const listDesc: CacheDescriptor = {
			family: "admin:entity:list",
			params: { entity: "users", query: "limit=20&page=1" },
			scope: "admin",
		};
		await readAdminEntity(f.env, undefined, listDesc);
		const listKey = await adminEntityCacheKey(f.env, listDesc);

		const rebuiltList = await rebuildCacheEntry(f.env, undefined, listKey);
		expect(rebuiltList.tier).toBe("SHORT");
		expect(rebuiltList.scope).toBe("admin");
		expect((rebuiltList.data as { items: unknown[] }).items.length).toBeGreaterThan(0);

		// Admin staff: admin:users:staff
		const staffDesc: CacheDescriptor = { family: "admin:users:staff", params: {}, scope: "admin" };
		await readAdminEntity(f.env, undefined, staffDesc);
		const staffKey = await adminEntityCacheKey(f.env, staffDesc);

		const rebuiltStaff = await rebuildCacheEntry(f.env, undefined, staffKey);
		expect(rebuiltStaff.tier).toBe("SHORT");
		expect(rebuiltStaff.scope).toBe("admin");
		expect(Array.isArray(rebuiltStaff.data)).toBe(true);

		// Admin thread-types: admin:thread-types
		const adminTtDesc: CacheDescriptor = {
			family: "admin:thread-types",
			params: { forumId: 1 },
			scope: "admin",
		};
		await readAdminEntity(f.env, undefined, adminTtDesc);
		const adminTtKey = await adminEntityCacheKey(f.env, adminTtDesc);

		const rebuiltAdminTt = await rebuildCacheEntry(f.env, undefined, adminTtKey);
		expect(rebuiltAdminTt.tier).toBe("SHORT");
		expect(rebuiltAdminTt.scope).toBe("admin");
	});

	it("dispatches admin-report and monitor loaders", async () => {
		// Admin report: display
		f.insert("reports", {
			id: 5,
			type: "post",
			target_id: 1,
			reporter_id: 10,
			reporter_name: "alice",
			reason: "spam",
			status: "pending",
			handler_name: "",
			created_at: 1_700_000_000,
		});

		const reportDesc: CacheDescriptor = {
			family: "admin:display",
			scope: "admin",
			params: {
				resource: "reports",
				operation: "list",
				status: null,
				type: null,
				reporterId: null,
				page: 1,
				limit: 20,
			},
		};
		await getAdminReport(f.env, undefined, reportDesc);
		const reportKey = await adminReportCacheKey(f.env, reportDesc);

		const rebuiltReport = await rebuildCacheEntry(f.env, undefined, reportKey);
		expect(rebuiltReport.tier).toBe("SHORT");
		expect(rebuiltReport.scope).toBe("admin");

		// Admin monitor: metrics:recent
		const metricsDesc: CacheDescriptor = {
			family: "monitor:metrics:recent",
			params: { resource: "metrics", family: null, minutes: 60 },
			scope: "admin",
		};
		const metricsKey = await monitorCacheKey(f.env, metricsDesc);
		await putCacheEnvelope(
			f.env,
			metricsKey,
			createCacheEnvelope(
				{
					family: null,
					minutes: 60,
					series: [{ family: "forum:tree:v2", tsMinute: 60, op: "hit", count: 4 }],
					observedAt: 1_700_000_000,
					source: "application:kv_cache_metrics_hour",
					intervalMinutes: 60,
					sampling: "best-effort",
					truncated: false,
					coverage: "complete",
				},
				{ ...metricsDesc, tier: "SHORT" },
			),
			"admin",
		);

		const rebuiltMetrics = await rebuildCacheEntry(f.env, undefined, metricsKey);
		expect(rebuiltMetrics.tier).toBe("SHORT");
		expect(rebuiltMetrics.scope).toBe("admin");
		expect((rebuiltMetrics.data as { series: unknown[] }).series).toBeDefined();
	});

	it("dispatches ip loader with mocked upstream fetch", async () => {
		const origFetch = globalThis.fetch;
		try {
			globalThis.fetch = vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							ip: "9.9.9.9",
							version: "v4",
							location: {
								country: "US",
								province: "California",
								city: "San Jose",
								isp: "Quad9",
								iso2: "US",
							},
							source: "echo",
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
			) as unknown as typeof fetch;

			f.env.IP_LOOKUP_API_KEY = "test_key";
			const ipDesc: CacheDescriptor = {
				family: "ip-lookup",
				params: { ip: "9.9.9.9" },
				scope: "admin",
			};
			const ipKey = ipLookupCacheKey(ipDesc);

			// Pre-populate
			await putCacheEnvelope(
				f.env,
				ipKey,
				createCacheEnvelope(
					{
						ip: "9.9.9.9",
						normalized: {
							country: "US",
							countryIso2: "US",
							region: "CA",
							city: "San Jose",
							isp: "Quad9",
							asn: null,
							org: null,
						},
						raw: { ok: true },
						rawTruncated: false,
						fetchedAt: 1_700_000_000,
					},
					{ ...ipDesc, tier: "LONG" },
				),
				"admin",
			);

			const rebuiltIp = await rebuildCacheEntry(f.env, undefined, ipKey);
			expect(rebuiltIp.tier).toBe("LONG");
			expect(rebuiltIp.scope).toBe("admin");
			expect((rebuiltIp.data as { ip: string }).ip).toBe("9.9.9.9");
		} finally {
			globalThis.fetch = origFetch;
		}
	});

	it("admin rebuild does not record business hit/miss metrics", async () => {
		const desc: CacheDescriptor = {
			family: "thread:entity",
			params: { threadId: 1 },
			scope: "internal",
		};
		const key = await (await import("../../../../src/lib/cache/thread-loaders")).readingCacheKey(
			f.env,
			desc,
		);
		await (await import("../../../../src/lib/cache/thread-loaders")).getThreadRows(
			f.env,
			undefined,
			[1],
		);

		__resetMetricsForTest();
		await rebuildCacheEntry(f.env, undefined, key);

		const metrics = swapSnapshot();
		const businessHitMiss = [...metrics.keys()].filter(
			(name) =>
				!name.includes("admin:") &&
				(name.includes("\x01hit\x01") ||
					name.includes("\x01miss\x01") ||
					name.includes("\x01read\x01")),
		);
		expect(businessHitMiss).toHaveLength(0);
	});

	it("32 concurrent distinct management targets => 33rd throws BUSY and frees capacity on finish", async () => {
		const running: Promise<unknown>[] = [];
		const gates: (() => void)[] = [];

		// Prepare 32 distinct target keys
		const keys: string[] = [];
		for (let i = 1; i <= 32; i++) {
			f.thread(100 + i);
			const d: CacheDescriptor = {
				family: "thread:entity",
				params: { threadId: 100 + i },
				scope: "internal",
			};
			const k = await (await import("../../../../src/lib/cache/thread-loaders")).readingCacheKey(
				f.env,
				d,
			);
			await (await import("../../../../src/lib/cache/thread-loaders")).getThreadRows(
				f.env,
				undefined,
				[100 + i],
			);
			keys.push(k);
		}

		// Hold delete open with real promises
		const origDelete = f.env.KV.delete;
		vi.mocked(f.env.KV.delete).mockImplementation(async (k: string) => {
			const { promise, resolve } = deferred<void>();
			gates.push(resolve);
			return promise.then(() => origDelete(k));
		});

		// Start 32 deleteCacheEntry calls
		for (let i = 0; i < 32; i++) {
			running.push(deleteCacheEntry(f.env, keys[i]));
		}

		// 33rd distinct target throws BUSY immediately
		f.thread(199);
		const d33: CacheDescriptor = {
			family: "thread:entity",
			params: { threadId: 199 },
			scope: "internal",
		};
		const k33 = await (await import("../../../../src/lib/cache/thread-loaders")).readingCacheKey(
			f.env,
			d33,
		);
		await (await import("../../../../src/lib/cache/thread-loaders")).getThreadRows(
			f.env,
			undefined,
			[199],
		);

		await expect(deleteCacheEntry(f.env, k33)).rejects.toMatchObject({
			code: "BUSY",
			stage: "validate",
		});

		// Resolve held operations and restore mock
		vi.mocked(f.env.KV.delete).mockReset();
		vi.mocked(f.env.KV.delete).mockImplementation(async (k: string) => {
			f.values.delete(k);
		});
		for (const gate of gates) gate();
		await Promise.all(running);

		// After resolution, new operations can proceed
		await expect(deleteCacheEntry(f.env, k33)).resolves.toBeUndefined();
	});

	it("late online fill cannot overwrite an active or completed management delete", async () => {
		const desc: CacheDescriptor = {
			family: "thread:entity",
			params: { threadId: 1 },
			scope: "internal",
		};
		const key = await (await import("../../../../src/lib/cache/thread-loaders")).readingCacheKey(
			f.env,
			desc,
		);
		await (await import("../../../../src/lib/cache/thread-loaders")).getThreadRows(
			f.env,
			undefined,
			[1],
		);

		// Start a late business fill
		const stall = deferred<{ subject: string }>();
		const filling = cacheGetOrSet(f.env, undefined, key, () => stall.promise, {
			...desc,
			tier: "MEDIUM",
		});

		// Delete the cache entry while fill is in flight
		await deleteCacheEntry(f.env, key);
		expect(f.values.has(key)).toBe(false);

		// Late loader settles; holdCacheWrites prevents it from refilling KV
		stall.resolve({ subject: "late payload" });
		await filling;

		// The key remains deleted — late loader was suppressed
		expect(f.values.has(key)).toBe(false);
	});
});
