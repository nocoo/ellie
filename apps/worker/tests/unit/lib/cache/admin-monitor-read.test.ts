import type { CacheDescriptor } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import { overview } from "../../../../src/handlers/admin/kv";
import {
	footprintFamilyName,
	getMonitorMetrics,
	getMonitorOverview,
	isMonitorCacheData,
	loadMonitorMetrics,
	loadMonitorOverview,
	METRICS_ROW_CAP,
	monitorCacheKey,
	monitorFamilyForMinutes,
	parseMonitorMetricsQuery,
	rebuildMonitorCache,
	validateMonitorDescriptor,
} from "../../../../src/lib/cache/admin-monitor-read";
import { createCacheEnvelope } from "../../../../src/lib/cache/store";
import { createAdminRequest, createMockDb, createMockKV, makeEnv } from "../../../helpers";
import { readingFixture } from "./thread-cache-fixture";

describe("monitor cache descriptors", () => {
	it("splits recent SHORT and history MEDIUM windows", () => {
		expect(monitorFamilyForMinutes(1)).toBe("monitor:metrics:recent");
		expect(monitorFamilyForMinutes(60)).toBe("monitor:metrics:recent");
		expect(monitorFamilyForMinutes(61)).toBe("monitor:metrics:history");
		expect(monitorFamilyForMinutes(10080)).toBe("monitor:metrics:history");
	});

	it("builds KV-only keys from exact dimensions", async () => {
		const env = makeEnv();
		const overview: CacheDescriptor = {
			family: "monitor:overview",
			scope: "admin",
			params: { resource: "overview" },
		};
		const recent: CacheDescriptor = {
			family: "monitor:metrics:recent",
			scope: "admin",
			params: { resource: "metrics", family: null, minutes: 60 },
		};
		const history: CacheDescriptor = {
			family: "monitor:metrics:history",
			scope: "admin",
			params: { resource: "metrics", family: "forum:tree:v2", minutes: 1440 },
		};
		const a = await monitorCacheKey(env, overview);
		expect(a).toMatch(/^cache:v3:monitor:overview:/);
		expect(await monitorCacheKey(env, recent)).not.toBe(a);
		expect(await monitorCacheKey(env, history)).not.toBe(await monitorCacheKey(env, recent));
	});
});

describe("monitor overview source read", () => {
	it("finishes a cold overview within the origin deadline with bounded KV concurrency", async () => {
		vi.useFakeTimers();
		try {
			const { KV_REGISTRY } = await import("../../../../src/lib/cache/kv-registry");
			const kv = createMockKV();
			const list = kv.list.getMockImplementation();
			if (!list) throw new Error("Missing KV list test implementation");
			let active = 0;
			let peak = 0;
			let started!: () => void;
			const firstList = new Promise<void>((resolve) => {
				started = resolve;
			});
			kv.list.mockImplementation(async (options) => {
				active++;
				peak = Math.max(peak, active);
				started();
				try {
					// 78 serial calls at ordinary remote latency exceed the 20s origin deadline.
					await new Promise((resolve) => setTimeout(resolve, 300));
					return await list(options);
				} finally {
					active--;
				}
			});
			const env = makeEnv({ KV: kv, DB: createMockDb().db });
			const beginning = Date.now();
			const result = getMonitorOverview(env, undefined).then(
				(data) => ({ data, error: null, elapsed: Date.now() - beginning }),
				(error) => ({ data: null, error, elapsed: Date.now() - beginning }),
			);
			await firstList;
			await vi.runAllTimersAsync();
			const cold = await result;
			expect(cold.error).toBeNull();
			expect(cold.elapsed).toBeLessThan(10_000);
			expect(peak).toBeGreaterThan(1);
			expect(peak).toBeLessThanOrEqual(4);
			expect(active).toBe(0);
			expect(cold.data?.families.map((row) => row.family)).toEqual(
				KV_REGISTRY.map((spec) => spec.family),
			);
			expect(kv.list).toHaveBeenCalledTimes(KV_REGISTRY.length);
			expect(env.DB.prepare).not.toHaveBeenCalled();
			expect(kv.put).toHaveBeenCalledOnce();
			const snapshot = JSON.parse(kv.put.mock.calls[0][1]);
			expect(snapshot.tier).toBe("MEDIUM");
			expect(snapshot.expiresAt - snapshot.loadedAt).toBe(1_800_000);
			const listed = kv.list.mock.calls.length;
			expect(await getMonitorOverview(env, undefined)).toEqual(cold.data);
			expect(kv.list).toHaveBeenCalledTimes(listed);
			expect(kv.put).toHaveBeenCalledOnce();
		} finally {
			await vi.runAllTimersAsync();
			vi.useRealTimers();
		}
	});

	it("bounds exact-key scans across empty incomplete pages without reporting an observed zero", async () => {
		const kv = createMockKV();
		const list = kv.list.getMockImplementation();
		if (!list) throw new Error("Missing KV list test implementation");
		let pages = 0;
		kv.list.mockImplementation(async (options) => {
			if (options?.prefix !== "settings:all") return list(options);
			pages++;
			if (pages > 4) throw new Error("Exact-key pagination exceeded its request budget");
			// KV may skip deleted/expired keys yet still return a continuation cursor.
			return { keys: [], list_complete: false, cursor: `deleted-page-${pages}` };
		});
		const data = await loadMonitorOverview(makeEnv({ KV: kv }));
		expect(data.families.find((row) => row.family === "settings:all")).toMatchObject({
			count: 0,
			countKind: "unknown",
			truncated: true,
			footprint: { kind: "unknown", bytes: null },
		});
		expect(pages).toBeLessThanOrEqual(4);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("follows an empty KV page to find the exact singleton within the scan budget", async () => {
		const kv = createMockKV();
		const list = kv.list.getMockImplementation();
		if (!list) throw new Error("Missing KV list test implementation");
		kv.list.mockImplementation(async (options) => {
			if (options?.prefix !== "settings:all") return list(options);
			if (!options.cursor) return { keys: [], list_complete: false, cursor: "after-deleted" };
			expect(options.cursor).toBe("after-deleted");
			return {
				keys: [{ name: "settings:all", expiration: undefined, metadata: undefined }],
				list_complete: true,
				cursor: "",
			};
		});
		const data = await loadMonitorOverview(makeEnv({ KV: kv }));
		expect(data.families.find((row) => row.family === "settings:all")).toMatchObject({
			count: 1,
			countKind: "observed",
			truncated: false,
		});
	});

	it("does not cache a successful-looking overview when a family listing fails", async () => {
		const kv = createMockKV();
		const list = kv.list.getMockImplementation();
		if (!list) throw new Error("Missing KV list test implementation");
		kv.list.mockImplementation(async (options) => {
			if (options?.prefix === "settings:all") throw new Error("KV list unavailable");
			return list(options);
		});
		const env = makeEnv({ KV: kv, DB: createMockDb().db });
		await expect(getMonitorOverview(env, undefined)).rejects.toThrow("KV list unavailable");
		expect(kv.put).not.toHaveBeenCalled();
		expect(env.DB.prepare).not.toHaveBeenCalled();
	});

	it("settles the current batch before rejecting so failed attempts cannot leave untracked scans", async () => {
		const kv = createMockKV();
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		kv.list.mockImplementation(async (options) => {
			if (options?.prefix === "cache:v3:monitor:overview:") throw new Error("KV list unavailable");
			await pending;
			return { keys: [], list_complete: true, cursor: "" };
		});
		let settled = false;
		const result = loadMonitorOverview(makeEnv({ KV: kv })).catch((error) => {
			settled = true;
			return error;
		});
		try {
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(settled).toBe(false);
			expect(kv.list.mock.calls.length).toBeLessThanOrEqual(4);
		} finally {
			release();
		}
		expect(await result).toEqual(new Error("KV list unavailable"));
		expect(kv.list).toHaveBeenCalledTimes(4);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("lists metadata without singleton value GET and does not seed gens", async () => {
		const kv = createMockKV({
			"online:1": JSON.stringify({ at: 1 }),
			"online:2": JSON.stringify({ at: 2 }),
			"settings:all": JSON.stringify({ site: "x" }),
		});
		const env = makeEnv({ KV: kv });
		const data = await loadMonitorOverview(env);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		const settings = data.families.find((row) => row.family === "settings:all");
		expect(settings?.count).toBe(1);
		expect(settings?.footprint.kind).toBe("unknown");
		const online = data.families.find((row) => row.family === "online:user");
		expect(online?.count).toBe(2);
		expect(online?.sampleKeys.every((key) => key.startsWith("online:u_"))).toBe(true);
		expect(settings?.currentVersionCount).toBeNull();
		expect(online?.currentVersionCount).toBeNull();
		expect(settings?.expiredCount).toBeNull();
		const rebuilt = await rebuildMonitorCache(env, undefined, {
			family: "monitor:overview",
			scope: "admin",
			params: { resource: "overview" },
		});
		expect(
			isMonitorCacheData(
				{ family: "monitor:overview", scope: "admin", params: { resource: "overview" } },
				rebuilt,
			),
		).toBe(true);
	});

	it("finds an exact singleton after sibling prefix keys and does not treat TTL as a generation", async () => {
		const kv = createMockKV();
		const keys = ["settings:all:v2", "settings:all"];
		kv.list = vi.fn(async (opts: { prefix?: string; cursor?: string; limit?: number } = {}) => {
			const prefix = opts.prefix ?? "";
			const matched = keys.filter((name) => name.startsWith(prefix));
			const from = opts.cursor ? matched.indexOf(opts.cursor) + 1 : 0;
			const slice = matched.slice(Math.max(0, from), Math.max(0, from) + 1);
			return {
				keys: slice.map((name) => ({
					name,
					metadata:
						name === "settings:all"
							? { schemaVersion: 3, expiresAt: Date.now() + 60_000, tier: "LONG" }
							: null,
				})),
				list_complete: from + slice.length >= matched.length,
				cursor: from + slice.length >= matched.length ? "" : slice[slice.length - 1],
			};
		}) as unknown as KVNamespace["list"];
		const env = makeEnv({ KV: kv });
		const data = await loadMonitorOverview(env);
		const settings = data.families.find((row) => row.family === "settings:all");
		expect(settings?.count).toBe(1);
		expect(settings?.countKind).toBe("observed");
		expect(settings?.currentVersionCount).toBeNull();
	});
});

describe("monitor metrics source read", () => {
	it("queries completed hourly points only, reuses warm snapshots, and rejects legacy minute envelopes", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(Date.parse("2026-09-17T12:34:56Z"));
		const f = readingFixture();
		const hour = Math.floor(Date.now() / 3_600_000);
		const descriptor: CacheDescriptor = {
			family: "monitor:metrics:history",
			scope: "admin",
			params: { resource: "metrics", family: null, minutes: 1440 },
		};
		try {
			for (const offset of [-25, -24, -1, 0]) {
				f.insert("kv_cache_metrics_hour", {
					family: "application:d1",
					ts_hour: hour + offset,
					op: "d1-rows-read",
					count: 5,
				});
			}
			f.insert("kv_cache_metrics_hour", {
				family: "admin:d1",
				ts_hour: hour - 1,
				op: "d1-rows-read",
				count: 10,
			});
			f.insert("kv_cache_metrics_minute", {
				family: "application:d1",
				ts_minute: hour * 60 - 1,
				op: "d1-rows-read",
				count: 9000,
			});
			const key = await monitorCacheKey(f.env, descriptor);
			f.values.set(
				key,
				JSON.stringify(
					createCacheEnvelope(
						{
							family: null,
							minutes: 1440,
							series: [
								{
									family: "application:d1",
									tsMinute: hour * 60 - 1,
									op: "d1-rows-read",
									count: 9000,
								},
							],
							observedAt: Date.now(),
							source: "application:kv_cache_metrics_minute",
							coverage: "complete",
							truncated: false,
						},
						{ ...descriptor, tier: "MEDIUM" },
					),
				),
			);
			expect(f.calls).toHaveLength(0);
			const result = await getMonitorMetrics(f.env, undefined, null, 1440);
			expect(result).toMatchObject({
				source: "application:kv_cache_metrics_hour",
				intervalMinutes: 60,
				sampling: "best-effort",
			});
			expect(result.series).toEqual([
				{ family: "admin:d1", tsMinute: (hour - 1) * 60, op: "d1-rows-read", count: 10 },
				{ family: "application:d1", tsMinute: (hour - 24) * 60, op: "d1-rows-read", count: 5 },
				{ family: "application:d1", tsMinute: (hour - 1) * 60, op: "d1-rows-read", count: 5 },
			]);
			expect(f.calls).toHaveLength(1);
			expect(f.calls[0].params).toEqual([hour - 24, hour, METRICS_ROW_CAP + 1]);
			expect(f.calls[0].sql).toContain("FROM kv_cache_metrics_hour");
			f.calls.length = 0;
			expect(await getMonitorMetrics(f.env, undefined, null, 1440)).toEqual(result);
			expect(f.calls).toHaveLength(0);
			const filtered = await loadMonitorMetrics(f.env, "admin:d1", 60);
			expect(filtered.series).toEqual([result.series[0]]);
			expect(f.calls).toHaveLength(1);
		} finally {
			f.close();
			vi.useRealTimers();
		}
	});

	it("throws on unconfirmed SQL and does not synthesize an empty cacheable page", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ success: false, results: [] }),
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		await expect(loadMonitorMetrics(env, null, 60)).rejects.toThrow(
			"Monitor metrics could not be loaded",
		);
	});

	it("maps confirmed rows and rejects invalid descriptors", async () => {
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({
						success: true,
						results: [{ family: "forum:tree:v2", ts_hour: 1, op: "hit", count: 4 }],
					}),
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const data = (await rebuildMonitorCache(env, undefined, {
			family: "monitor:metrics:recent",
			scope: "admin",
			params: { resource: "metrics", family: null, minutes: 60 },
		})) as { series: { op: string; count: number }[] };
		expect(data.series).toEqual([{ family: "forum:tree:v2", tsMinute: 60, op: "hit", count: 4 }]);
		expect((data as { coverage: string; truncated: boolean }).coverage).toBe("complete");
		expect((data as { truncated: boolean }).truncated).toBe(false);
		await expect(
			rebuildMonitorCache(env, undefined, {
				family: "monitor:metrics:recent",
				scope: "admin",
				params: { resource: "metrics", family: null, minutes: 90 },
			}),
		).rejects.toThrow();
	});

	it("bounds metric rows and marks partial coverage without caching SQL failure", async () => {
		const rows = Array.from({ length: METRICS_ROW_CAP + 3 }, (_, i) => ({
			family: "forum:tree:v2",
			ts_hour: i,
			op: "hit",
			count: 1,
		}));
		const db = {
			prepare: () => ({
				bind: () => ({
					all: async () => ({ success: true, results: rows }),
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const data = await loadMonitorMetrics(env, null, 10080);
		expect(data.series).toHaveLength(METRICS_ROW_CAP);
		expect(data.truncated).toBe(true);
		expect(data.coverage).toBe("partial");
		expect(
			isMonitorCacheData(
				{
					family: "monitor:metrics:history",
					scope: "admin",
					params: { resource: "metrics", family: null, minutes: 10080 },
				},
				data,
			),
		).toBe(true);
	});
});

describe("live overview handler", () => {
	it("does not GET singleton values", async () => {
		const kv = createMockKV({ "settings:all": JSON.stringify({ site: "x" }) });
		const env = makeEnv({ KV: kv });
		const res = await overview(createAdminRequest("GET", "/api/admin/kv/overview"), env);
		expect(res.status).toBe(200);
		expect(kv.get.mock.calls.every((call) => call[0] !== "settings:all")).toBe(true);
		expect(res.headers.get("Cache-Control")).toBe("no-store, private");
	});
});

describe("monitor descriptor validation and masking", () => {
	it("parses query windows and rejects bad descriptors", () => {
		expect(parseMonitorMetricsQuery({})).toEqual({ family: null, minutes: 1440 });
		expect(parseMonitorMetricsQuery({ minutes: "0", family: "" })).toEqual({
			family: null,
			minutes: 60,
		});
		expect(parseMonitorMetricsQuery({ minutes: 99999, family: "forum:tree:v2" })).toEqual({
			family: "forum:tree:v2",
			minutes: 10_080,
		});
		expect(footprintFamilyName("thread:list")).toBe("footprint:thread:list");
		expect(() =>
			validateMonitorDescriptor({
				family: "monitor:overview",
				scope: "public",
				params: { resource: "overview" },
			}),
		).toThrow(/Admin scope/);
		expect(
			isMonitorCacheData(
				{ family: "monitor:overview", scope: "admin", params: { resource: "overview" } },
				{ observedAt: 1, source: "x", families: "nope" },
			),
		).toBe(false);
	});

	it("masks IP sample keys and hides names on hide families", async () => {
		const kv = createMockKV({
			"login-ip:10.1.2.3": "1",
			"refresh:abc": "tok",
		});
		const env = makeEnv({ KV: kv });
		const data = await loadMonitorOverview(env);
		const login = data.families.find((row) => row.family === "login-ip");
		expect(login?.sampleKeys.some((key) => key.includes("10.1") && key.includes("*.*"))).toBe(true);
		const refresh = data.families.find((row) => row.family === "refresh");
		expect(refresh?.sampleKeys).toEqual([]);
	});

	it("does not treat an exact miss past sibling scan as observed zero", async () => {
		const kv = createMockKV();
		kv.list = vi.fn(async (opts: { prefix?: string } = {}) => {
			if (opts.prefix === "settings:all") {
				return {
					keys: Array.from({ length: 32 }, (_, i) => ({ name: `settings:all:sib${i}` })),
					list_complete: false,
					cursor: "more",
				};
			}
			return { keys: [], list_complete: true, cursor: "" };
		}) as unknown as KVNamespace["list"];
		const data = await loadMonitorOverview(makeEnv({ KV: kv }));
		const settings = data.families.find((row) => row.family === "settings:all");
		expect(settings?.count).toBe(0);
		expect(settings?.countKind).toBe("unknown");
		expect(settings?.truncated).toBe(true);
		expect(settings?.currentVersionCount).toBeNull();
	});

	it("marks a capped prefix listing as at-least and never certifies generation from TTL", async () => {
		const kv = createMockKV();
		kv.list = vi.fn(async (opts: { prefix?: string } = {}) => {
			if (opts.prefix === "online:") {
				return {
					keys: Array.from({ length: 1000 }, (_, i) => ({
						name: `online:${i}`,
						metadata:
							i === 0
								? { contentUtf8Bytes: 8, expiresAt: 1, schemaVersion: 3 }
								: { expiresAt: Date.now() + 60_000 },
					})),
					list_complete: false,
					cursor: "more",
				};
			}
			return { keys: [], list_complete: true, cursor: "" };
		}) as unknown as KVNamespace["list"];
		const data = await loadMonitorOverview(makeEnv({ KV: kv }));
		const online = data.families.find((row) => row.family === "online:user");
		expect(online?.count).toBe(1000);
		expect(online?.countKind).toBe("at-least");
		expect(online?.truncated).toBe(true);
		expect(online?.footprint).toEqual({ kind: "at-least", bytes: 8 });
		expect(online?.expiredCount).toBeGreaterThan(0);
		expect(online?.currentVersionCount).toBeNull();
		expect(online?.presence).toBe("present");
		expect(online?.actions.restriction).toBe("runtime-state");
	});

	it("observes exact singleton bytes from list metadata without a value GET", async () => {
		const kv = createMockKV();
		await kv.put("settings:all", "{}", {
			metadata: { contentUtf8Bytes: 40, expiresAt: Date.now() + 60_000 },
		});
		const data = await loadMonitorOverview(makeEnv({ KV: kv }));
		expect(kv.get).not.toHaveBeenCalled();
		const settings = data.families.find((row) => row.family === "settings:all");
		expect(settings?.footprint).toEqual({ kind: "observed", bytes: 40 });
		expect(settings?.expiredCount).toBe(0);
		expect(settings?.currentVersionCount).toBeNull();
	});

	it("masks IPv6 suffixes and hashes user ids, and labels planned families", async () => {
		const kv = createMockKV({
			"login-ip:2001:db8:85a3:0:0:8a2e:370:7334": "1",
			"activity_throttle:99": "1",
		});
		const data = await loadMonitorOverview(makeEnv({ KV: kv }));
		const login = data.families.find((row) => row.family === "login-ip");
		expect(login?.sampleKeys.some((key) => key.startsWith("login-ip:2001:db8:85a3:0::"))).toBe(
			true,
		);
		const throttle = data.families.find((row) => row.family === "activity_throttle");
		expect(throttle?.sampleKeys[0]).toMatch(/^activity_throttle:u_[0-9a-f]{6}$/);
		const planned = data.families.find((row) => row.family === "user:mini:v2");
		expect(planned?.presence).toBe("planned");
		expect(planned?.actions.restriction).toBe("planned");
		const refresh = data.families.find((row) => row.family === "refresh");
		expect(refresh?.presence).toBe("absent");
		expect(refresh?.actions.inspect).toBe(false);
		expect(refresh?.actions.restriction).toBe("runtime-state");
	});

	it("rejects bad monitor dimensions and incomplete cache payloads", () => {
		expect(parseMonitorMetricsQuery({ minutes: "nope" })).toEqual({ family: null, minutes: 1440 });
		expect(() =>
			validateMonitorDescriptor({
				family: "forum:tree:v2",
				scope: "admin",
				params: { resource: "overview" },
			}),
		).toThrow(/Unknown monitor family/);
		expect(() =>
			validateMonitorDescriptor({
				family: "monitor:overview",
				scope: "admin",
				params: { resource: "overview", extra: 1 },
			}),
		).toThrow(/Invalid monitor dimensions/);
		expect(() =>
			validateMonitorDescriptor({
				family: "monitor:overview",
				scope: "admin",
				params: { resource: "metrics" },
			}),
		).toThrow(/Invalid monitor resource/);
		expect(() =>
			validateMonitorDescriptor({
				family: "monitor:metrics:recent",
				scope: "admin",
				params: { resource: "metrics", family: null, minutes: 1440 },
			}),
		).toThrow(/Metrics family does not match window/);
		expect(() =>
			validateMonitorDescriptor({
				family: "monitor:metrics:history",
				scope: "admin",
				params: { resource: "metrics", family: "x".repeat(129), minutes: 1440 },
			}),
		).toThrow(/Invalid metrics family/);
		expect(
			isMonitorCacheData(
				{
					family: "monitor:metrics:recent",
					scope: "admin",
					params: { resource: "metrics", family: null, minutes: 60 },
				},
				{
					observedAt: 1,
					source: "x",
					family: null,
					minutes: 60,
					coverage: "complete",
					truncated: false,
					series: [{ family: "forum:tree:v2", tsMinute: 60, op: "hit" }],
				},
			),
		).toBe(false);
	});

	it("filters metrics SQL by family and rebuilds overview from the pure loader", async () => {
		const binds: unknown[][] = [];
		const db = {
			prepare: () => ({
				bind: (...args: unknown[]) => {
					binds.push(args);
					return {
						all: async () => ({
							success: true,
							results: [{ family: "forum:tree:v2", ts_hour: 9, op: "miss", count: 2 }],
						}),
					};
				},
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const metrics = await loadMonitorMetrics(env, "forum:tree:v2", 60);
		expect(binds[0]?.[2]).toBe("forum:tree:v2");
		expect(binds[0]?.[3]).toBe(METRICS_ROW_CAP + 1);
		expect(metrics.series).toEqual([
			{ family: "forum:tree:v2", tsMinute: 540, op: "miss", count: 2 },
		]);
		const overview = await rebuildMonitorCache(env, undefined, {
			family: "monitor:overview",
			scope: "admin",
			params: { resource: "overview" },
		});
		expect(
			isMonitorCacheData(
				{ family: "monitor:overview", scope: "admin", params: { resource: "overview" } },
				overview,
			),
		).toBe(true);
	});
});
