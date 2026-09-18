import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	catalogCacheKey,
	currentCatalogForums,
	currentCatalogThreads,
	getCachedThreadTypes,
	getCatalogPage,
	getDigestGroups,
	isCatalogCacheData,
	loadCatalogPage,
	loadDigestGroups,
	loadThreadTypes,
	rebuildCatalogCache,
	validateCatalogDescriptor,
} from "../../../../src/lib/cache/catalog-read";
import { __resetMetricsForTest } from "../../../../src/lib/cache/metrics";
import { readingFixture } from "./thread-cache-fixture";

describe("lib/cache/catalog-read", () => {
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

	describe("validateCatalogDescriptor & catalogCacheKey", () => {
		it("validates search:threads descriptor and normalizes key", async () => {
			const validDesc = {
				family: "search:threads",
				scope: "role:member",
				params: { bucket: "member", q: "hello world", limit: 20, cursorTime: null, cursorId: null },
			};
			validateCatalogDescriptor(validDesc);
			const key = await catalogCacheKey(f.env, validDesc);
			expect(key).toContain("cache:v3:search:threads:");

			// Invalid search descriptor: q too short
			expect(() =>
				validateCatalogDescriptor({
					...validDesc,
					params: { ...validDesc.params, q: "a" },
				}),
			).toThrow("Invalid search");

			// Invalid scope
			expect(() =>
				validateCatalogDescriptor({
					...validDesc,
					scope: "role:anon",
				}),
			).toThrow("Invalid catalog audience");
		});

		it("validates digest:list descriptor with cursors", async () => {
			const desc = {
				family: "digest:list",
				scope: "role:anon",
				params: {
					bucket: "anon",
					forumId: 1,
					level: 1,
					year: 2024,
					limit: 20,
					cursorDigest: null,
					cursorTime: null,
					cursorId: null,
				},
			};
			validateCatalogDescriptor(desc);
			const key = await catalogCacheKey(f.env, desc);
			expect(key).toContain("cache:v3:digest:list:");

			// Incomplete cursor (cursorDigest without cursorId)
			expect(() =>
				validateCatalogDescriptor({
					...desc,
					params: { ...desc.params, cursorDigest: 1 },
				}),
			).toThrow("Incomplete cursor");
		});

		it("validates thread-types key format: thread-types:{forumId}", async () => {
			const desc = {
				family: "thread-types",
				scope: "internal",
				params: { forumId: 5 },
			};
			validateCatalogDescriptor(desc);
			const key = await catalogCacheKey(f.env, desc);
			expect(key).toBe("thread-types:5");

			expect(() =>
				validateCatalogDescriptor({
					...desc,
					scope: "public",
				}),
			).toThrow("Invalid recommendation scope");
		});
	});

	describe("loadCatalogPage & FTS search", () => {
		it("performs SQLite FTS search and returns actual results with count", async () => {
			// In readingFixture, thread() triggers FTS insert automatically via SQLite triggers
			f.thread(1, { subject: "JavaScript guide" });
			f.thread(2, { subject: "Rust programming" });

			const page = await loadCatalogPage(f.env, {
				family: "search:threads",
				scope: "role:member",
				params: { bucket: "member", q: "JavaScript", limit: 20, cursorTime: null, cursorId: null },
			});

			expect(page.items).toHaveLength(1);
			expect(page.items[0].id).toBe(1);
			expect(page.total).toBe(1);
			expect(page.hasMore).toBe(false);
		});

		it("returns empty items array for no matches with SHORT tier caching", async () => {
			const desc = {
				family: "search:threads",
				scope: "role:anon",
				params: { bucket: "anon", q: "nonexistent", limit: 20, cursorTime: null, cursorId: null },
			};
			const page = await getCatalogPage(f.env, f.ctx, desc);
			expect(page.items).toEqual([]);
			expect(page.total).toBe(0);

			// Check KV cache envelope tier: negative/empty results use SHORT tier
			const key = await catalogCacheKey(f.env, desc);
			const raw = (await f.env.KV.get(key, "json")) as { tier: string; data: unknown };
			expect(raw).toBeDefined();
			expect(raw.tier).toBe("SHORT");
		});
	});

	describe("digest membership & aggregates", () => {
		it("loadCatalogPage loads digest threads filtered by level and year", async () => {
			// Thread 1: digest=1, created in 2024 (1711540800)
			f.thread(1, { digest: 1, created_at: 1711540800, last_post_at: 1711540800 });
			// Thread 2: digest=2, created in 2023 (1680000000)
			f.thread(2, { digest: 2, created_at: 1680000000, last_post_at: 1680000000 });

			const page2024 = await loadCatalogPage(f.env, {
				family: "digest:list",
				scope: "role:member",
				params: {
					bucket: "member",
					forumId: null,
					level: 1,
					year: 2024,
					limit: 20,
					cursorDigest: null,
					cursorTime: null,
					cursorId: null,
				},
			});
			expect(page2024.items).toHaveLength(1);
			expect(page2024.items[0].id).toBe(1);

			const page2023 = await loadCatalogPage(f.env, {
				family: "digest:list",
				scope: "role:member",
				params: {
					bucket: "member",
					forumId: null,
					level: null,
					year: 2023,
					limit: 20,
					cursorDigest: null,
					cursorTime: null,
					cursorId: null,
				},
			});
			expect(page2023.items).toHaveLength(1);
			expect(page2023.items[0].id).toBe(2);
		});

		it("loadDigestGroups calculates per-forum, per-year, per-digest counts", async () => {
			f.thread(1, { forum_id: 1, digest: 1, created_at: 1711540800 });
			f.thread(2, { forum_id: 1, digest: 1, created_at: 1711540800 });
			f.thread(3, { forum_id: 1, digest: 2, created_at: 1711540800 });

			const groups = await loadDigestGroups(f.env);
			expect(groups.length).toBeGreaterThanOrEqual(2);
			const g1 = groups.find((g) => g.forumId === 1 && g.digest === 1);
			const g2 = groups.find((g) => g.forumId === 1 && g.digest === 2);
			expect(g1?.count).toBe(2);
			expect(g2?.count).toBe(1);
		});

		it.each(["digest:stats", "digest:filters"] as const)(
			"%s caches imported forum-zero groups without repeating the aggregate",
			async (family) => {
				f.insert("forums", { id: 0, name: "Deleted forum", status: -1 });
				f.thread(1, { forum_id: 0, digest: 1, created_at: 1_104_537_600 });
				f.thread(2, { forum_id: 1, digest: 2, created_at: 1_711_540_800 });
				const descriptor = { family: "digest:stats", params: {}, scope: "internal" };
				const expected = [
					{ forumId: 0, year: 2005, digest: 1, count: 1 },
					{ forumId: 1, year: 2024, digest: 2, count: 1 },
				];

				expect(await getDigestGroups(f.env, undefined, family)).toEqual(expected);
				const key = await catalogCacheKey(f.env, descriptor);
				const snapshot = JSON.parse(f.values.get(key) ?? "null");
				expect(snapshot).toMatchObject({ tier: "LONG", scope: "internal", data: expected });
				expect(snapshot.expiresAt - snapshot.loadedAt).toBe(86_400_000);
				const coldQueries = f.calls.length;
				expect(coldQueries).toBe(1);
				expect(await getDigestGroups(f.env, undefined, family)).toEqual(expected);
				expect(f.calls).toHaveLength(coldQueries);
				expect(JSON.parse(f.values.get(key) ?? "null")).toEqual(snapshot);

				const puts = vi.mocked(f.env.KV.put).mock.calls.length;
				const rebuilt = await rebuildCatalogCache(f.env, undefined, descriptor);
				expect(rebuilt).toEqual(expected);
				expect(isCatalogCacheData(descriptor, rebuilt)).toBe(true);
				expect(vi.mocked(f.env.KV.put).mock.calls).toHaveLength(puts);
				expect(f.calls.every((call) => call.mode === "all")).toBe(true);
			},
		);

		it("stats and filters share one aggregate and digest changes invalidate it", async () => {
			f.thread(1, { digest: 1 });
			await Promise.all([
				getDigestGroups(f.env, f.ctx, "digest:stats"),
				getDigestGroups(f.env, f.ctx, "digest:filters"),
			]);
			expect(f.calls).toHaveLength(1);
			f.thread(2, { digest: 1 });
			await f.env.KV.put("digest:gen", "changed");
			expect((await getDigestGroups(f.env, f.ctx, "digest:filters"))[0].count).toBe(2);
		});

		it("keeps digest aggregate types and public forum parameters strict", () => {
			const descriptor = { family: "digest:stats", params: {}, scope: "internal" };
			const group = { forumId: 0, year: 2005, digest: 1, count: 1 };
			for (const invalid of [
				{ forumId: -1 },
				{ forumId: "0" },
				{ forumId: Number.MAX_SAFE_INTEGER + 1 },
				{ year: null },
				{ digest: 4 },
				{ count: 0 },
				{ content: "unexpected" },
			]) {
				expect(isCatalogCacheData(descriptor, [{ ...group, ...invalid }])).toBe(false);
			}
			expect(() =>
				validateCatalogDescriptor({
					family: "thread-types",
					params: { forumId: 0 },
					scope: "internal",
				}),
			).toThrow("Invalid recommendation scope");
		});

		it("getDigestGroups caches with LONG tier for populated groups and SHORT for empty", async () => {
			f.thread(1, { forum_id: 1, digest: 1, created_at: 1711540800 });
			const groups = await getDigestGroups(f.env, f.ctx, "digest:stats");
			expect(groups.length).toBeGreaterThan(0);

			const key = await catalogCacheKey(f.env, {
				family: "digest:stats",
				params: {},
				scope: "internal",
			});
			const raw = (await f.env.KV.get(key, "json")) as { tier: string };
			expect(raw.tier).toBe("LONG");
		});
	});

	describe("recommended:threads & thread-types", () => {
		it("loadCatalogPage loads recommended threads in forum up to 6", async () => {
			for (let i = 1; i <= 8; i++) {
				f.thread(i, { forum_id: 1 });
				f.sqlite
					.prepare(
						"INSERT INTO forum_recommended_threads (forum_id, thread_id, recommended_by, recommended_at) VALUES (1, ?, 1, ?)",
					)
					.run(i, 1000 + i);
			}

			const page = await loadCatalogPage(f.env, {
				family: "recommended:threads",
				scope: "internal",
				params: { forumId: 1 },
			});

			expect(page.items).toHaveLength(6);
			// Ordered by thread_id DESC
			expect(page.items[0].id).toBe(8);
			expect(page.items[5].id).toBe(3);
			expect(page.hasMore).toBe(false);
		});

		it("loadThreadTypes reads forum flags and enabled thread types ordered by display_order", async () => {
			f.sqlite
				.prepare(
					"UPDATE forums SET thread_types_enabled = 1, thread_types_required = 1, thread_types_listable = 1, thread_types_prefix = 1 WHERE id = 1",
				)
				.run();
			f.sqlite
				.prepare(
					"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, enabled, moderator_only) VALUES (10, 1, 100, 'Bug', 2, 1, 0), (11, 1, 101, 'Question', 1, 1, 0), (12, 1, 102, 'Disabled', 0, 0, 0)",
				)
				.run();

			const res = await loadThreadTypes(f.env, 1);
			expect(res).not.toBeNull();
			expect(res?.enabled).toBe(true);
			expect(res?.required).toBe(true);
			expect(res?.listable).toBe(true);
			expect(res?.prefix).toBe(true);
			expect(res?.types).toHaveLength(2);
			// ordered by display_order ASC (1, then 2)
			expect(res?.types[0].name).toBe("Question");
			expect(res?.types[1].name).toBe("Bug");
		});

		it("getCachedThreadTypes caches with LONG tier when populated", async () => {
			f.sqlite.prepare("UPDATE forums SET thread_types_enabled = 1 WHERE id = 1").run();
			f.sqlite
				.prepare(
					"INSERT INTO forum_thread_types (id, forum_id, source_typeid, name, display_order, enabled, moderator_only) VALUES (20, 1, 200, 'Discussion', 1, 1, 0)",
				)
				.run();

			const res = await getCachedThreadTypes(f.env, f.ctx, 1);
			expect(res).not.toBeNull();
			expect(res?.types).toHaveLength(1);

			const raw = (await f.env.KV.get("thread-types:1", "json")) as { tier: string };
			expect(raw.tier).toBe("LONG");
		});
	});

	describe("currentCatalogThreads & currentCatalogForums", () => {
		it("composes current gates without re-executing aggregate SQL", async () => {
			f.thread(1, { forum_id: 1 });
			const threads = await currentCatalogThreads(f.env, f.ctx, [1], null);
			expect(threads).toHaveLength(1);
			expect(threads[0].id).toBe(1);

			// Inactive forum threads are excluded by current gate
			f.sqlite.prepare("UPDATE forums SET status = 0 WHERE id = 1").run();
			const threadsHidden = await currentCatalogThreads(f.env, f.ctx, [1], null);
			expect(threadsHidden).toHaveLength(0);
		});

		it("currentCatalogForums filters by status and viewer visibility", async () => {
			// forum 1 is public, forum 2 is staff
			const anonForums = await currentCatalogForums(f.env, null);
			expect(anonForums.has(1)).toBe(true);
			expect(anonForums.has(2)).toBe(false);

			const staffForums = await currentCatalogForums(f.env, { userId: 30, role: 3 });
			expect(staffForums.has(2)).toBe(true);
		});
	});

	describe("rebuildCatalogCache", () => {
		it("rebuilds catalog cache descriptors accurately", async () => {
			const desc = { family: "thread-types", scope: "internal", params: { forumId: 1 } };
			const types = (await rebuildCatalogCache(f.env, f.ctx, desc)) as { enabled: boolean };
			expect(types).toBeDefined();

			const statsDesc = { family: "digest:stats", scope: "internal", params: {} };
			const groups = (await rebuildCatalogCache(f.env, f.ctx, statsDesc)) as unknown[];
			expect(Array.isArray(groups)).toBe(true);
		});
	});

	describe("negative cases, invalid descriptors, and failed origin recovery", () => {
		it("rejects invalid descriptors across catalog families", async () => {
			// Unknown family
			expect(() =>
				validateCatalogDescriptor({
					family: "unknown:family",
					scope: "internal",
					params: {},
				}),
			).toThrow("Unknown catalog cache");

			// Invalid limit bounds (> 50 or < 1)
			expect(() =>
				validateCatalogDescriptor({
					family: "search:threads",
					scope: "role:anon",
					params: { bucket: "anon", q: "test", limit: 0, cursorTime: null, cursorId: null },
				}),
			).toThrow("Invalid page size");

			expect(() =>
				validateCatalogDescriptor({
					family: "search:threads",
					scope: "role:anon",
					params: { bucket: "anon", q: "test", limit: 51, cursorTime: null, cursorId: null },
				}),
			).toThrow("Invalid page size");

			// Invalid level on digest:list
			expect(() =>
				validateCatalogDescriptor({
					family: "digest:list",
					scope: "role:anon",
					params: {
						bucket: "anon",
						forumId: null,
						level: 4,
						year: null,
						limit: 20,
						cursorDigest: null,
						cursorTime: null,
						cursorId: null,
					},
				}),
			).toThrow("Invalid digest level");
		});

		it("loadCatalogPage throws when search count query fails", async () => {
			f.thread(1, { subject: "Search Subject" });
			const origPrepare = f.env.DB.prepare.bind(f.env.DB);
			vi.spyOn(f.env.DB, "prepare").mockImplementation((sql: string) => {
				if (sql.includes("SELECT COUNT(*) AS count FROM threads t")) {
					return {
						bind: () => ({
							first: async () => null,
						}),
					} as unknown as D1PreparedStatement;
				}
				return origPrepare(sql);
			});

			await expect(
				loadCatalogPage(f.env, {
					family: "search:threads",
					scope: "role:anon",
					params: { bucket: "anon", q: "Search", limit: 20, cursorTime: null, cursorId: null },
				}),
			).rejects.toThrow("Search count could not be loaded");
		});

		it("loadCatalogPage throws when recommendations query fails", async () => {
			const origPrepare = f.env.DB.prepare.bind(f.env.DB);
			vi.spyOn(f.env.DB, "prepare").mockImplementationOnce((sql: string) => {
				if (sql.includes("FROM forum_recommended_threads r")) {
					return {
						bind: () => ({
							all: async () => ({ success: false, results: [] }),
						}),
					} as unknown as D1PreparedStatement;
				}
				return origPrepare(sql);
			});

			await expect(
				loadCatalogPage(f.env, {
					family: "recommended:threads",
					scope: "internal",
					params: { forumId: 1 },
				}),
			).rejects.toThrow("Recommendations could not be loaded");
		});

		it("loadDigestGroups throws when D1 query is not confirmed", async () => {
			f.state.queryError = true;
			await expect(loadDigestGroups(f.env)).rejects.toThrow(
				"Digest aggregates could not be loaded",
			);
		});

		it("heals poisoned/wrong-association catalog cache envelope on next read", async () => {
			f.thread(1, { subject: "Match Query" });
			const desc = {
				family: "search:threads",
				scope: "role:anon",
				params: { bucket: "anon", q: "Match", limit: 20, cursorTime: null, cursorId: null },
			};
			const key = await catalogCacheKey(f.env, desc);

			// Inject corrupted/wrong envelope
			await f.env.KV.put(
				key,
				JSON.stringify({
					schemaVersion: 3,
					family: "search:threads",
					tier: "SHORT",
					loadedAt: Date.now(),
					expiresAt: Date.now() + 60_000,
					params: desc.params,
					scope: desc.scope,
					data: { items: [{ id: 999, invalidField: true }], total: -1, hasMore: "not-bool" },
				}),
			);

			// getCatalogPage detects invalid data via isCatalogCacheData, misses, and reloads from D1
			const page = await getCatalogPage(f.env, f.ctx, desc);
			expect(page.items).toHaveLength(1);
			expect(page.items[0].id).toBe(1);
			expect(page.total).toBe(1);
		});
	});
});
