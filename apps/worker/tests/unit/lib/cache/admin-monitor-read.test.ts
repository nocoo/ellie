import type { CacheDescriptor } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import { overview } from "../../../../src/handlers/admin/kv";
import {
	footprintFamilyName,
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
import { createAdminRequest, createMockKV, makeEnv } from "../../../helpers";

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
						results: [{ family: "forum:tree:v2", ts_minute: 1, op: "hit", count: 4 }],
					}),
				}),
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db });
		const data = (await rebuildMonitorCache(env, undefined, {
			family: "monitor:metrics:recent",
			scope: "admin",
			params: { resource: "metrics", family: null, minutes: 15 },
		})) as { series: { op: string; count: number }[] };
		expect(data.series).toEqual([{ family: "forum:tree:v2", tsMinute: 1, op: "hit", count: 4 }]);
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
			ts_minute: i,
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
		expect(parseMonitorMetricsQuery({})).toEqual({ family: null, minutes: 60 });
		expect(parseMonitorMetricsQuery({ minutes: "0", family: "" })).toEqual({
			family: null,
			minutes: 1,
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
		expect(parseMonitorMetricsQuery({ minutes: "nope" })).toEqual({ family: null, minutes: 60 });
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
					params: { resource: "metrics", family: null, minutes: 15 },
				},
				{
					observedAt: 1,
					source: "x",
					family: null,
					minutes: 15,
					coverage: "complete",
					truncated: false,
					series: [{ family: "forum:tree:v2", tsMinute: 1, op: "hit" }],
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
							results: [{ family: "forum:tree:v2", ts_minute: 9, op: "miss", count: 2 }],
						}),
					};
				},
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const metrics = await loadMonitorMetrics(env, "forum:tree:v2", 60);
		expect(binds[0]?.[1]).toBe("forum:tree:v2");
		expect(binds[0]?.[2]).toBe(METRICS_ROW_CAP + 1);
		expect(metrics.series).toEqual([
			{ family: "forum:tree:v2", tsMinute: 9, op: "miss", count: 2 },
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
