import { describe, expect, it } from "vitest";
import {
	cacheMutationError,
	canPreviewValue,
	classifyLifecycle,
	contentUtf8Bytes,
	d1ObservationPoints,
	formatBytes,
	formatCount,
	formatFootprint,
	formatRemaining,
	formatScope,
	formatTimestamp,
	formatTtl,
	hitRateLabel,
	insertGapPoints,
	isUserHitRateFamily,
	LIFECYCLE_LABEL,
	mergeOccupancySnapshot,
	mutationNotice,
	occupancyForWindow,
	occupancyFromMetrics,
	occupancyFromOverview,
	physicalExpirationMs,
	remainingMs,
	sensitiveValueLabel,
	summarizeD1Observation,
	summarizeFamilyOps,
	tierFromTtl,
	totalsFromSummaries,
	utf8ByteLength,
} from "../../../src/lib/admin-kv-cache";

describe("utf8 bytes", () => {
	it("counts CJK as multiple bytes", () => {
		expect(utf8ByteLength("主题")).toBe(6);
		expect(contentUtf8Bytes({ title: "主题" })).toBe(contentUtf8Bytes('{"title":"主题"}'));
	});
});

describe("tierFromTtl", () => {
	it("maps only the three legal tiers", () => {
		expect(tierFromTtl(60)).toBe("SHORT");
		expect(tierFromTtl(1800)).toBe("MEDIUM");
		expect(tierFromTtl(86400)).toBe("LONG");
		expect(tierFromTtl(300)).toBeNull();
		expect(tierFromTtl(900)).toBeNull();
		expect(tierFromTtl("sticky")).toBeNull();
	});
});

describe("footprint and counts never coerce unknown to 0", () => {
	it("labels unknown / at-least / estimated distinctly", () => {
		expect(formatFootprint({ kind: "unknown" })).toBe("未知");
		expect(formatFootprint({ kind: "observed", bytes: 2048 })).toBe("已观察 2.0 KiB");
		expect(formatFootprint({ kind: "at-least", bytes: 100 })).toBe("至少 100 B");
		expect(
			formatFootprint({ kind: "estimated", bytes: 4096, sampleSize: 12, scanComplete: false }),
		).toContain("估算");
		expect(formatCount(null, "unknown")).toBe("未知");
		expect(formatCount(3, "at-least")).toBe("至少 3");
		expect(formatCount(3, "observed")).toBe("已发现 3");
	});
});

describe("lifecycle", () => {
	const now = 1_000_000;
	it("distinguishes missing, expired, stale version, and diagnostic snapshots", () => {
		expect(classifyLifecycle({ found: false, enrolled: true, expiresAt: null, now })).toBe(
			"not-found",
		);
		expect(classifyLifecycle({ found: true, enrolled: false, expiresAt: now + 1, now })).toBe(
			"not-enrolled",
		);
		expect(classifyLifecycle({ found: true, enrolled: true, expiresAt: now, now })).toBe(
			"logically-expired",
		);
		expect(
			classifyLifecycle({
				found: true,
				enrolled: true,
				expiresAt: now + 5_000,
				now,
				entryVersion: "a",
				currentVersion: "b",
			}),
		).toBe("stale-version");
		expect(
			classifyLifecycle({
				found: true,
				enrolled: true,
				expiresAt: now - 1,
				now,
				entryVersion: "a",
				currentVersion: "b",
			}),
		).toBe("diagnostic-snapshot");
		expect(classifyLifecycle({ found: true, enrolled: true, expiresAt: now + 1, now })).toBe(
			"valid",
		);
		expect(
			classifyLifecycle({
				found: true,
				enrolled: true,
				expiresAt: now + 1,
				now,
				runtimeState: true,
			}),
		).toBe("runtime-state");
	});
});

describe("hit rate and occupancy aggregation", () => {
	it("computes hit rate from window totals, not averaged percents", () => {
		expect(hitRateLabel(0, 0)).toBe("无请求");
		const summaries = summarizeFamilyOps([
			{ family: "a", tsMinute: 60, op: "hit", count: 9 },
			{ family: "a", tsMinute: 60, op: "miss", count: 1 },
			{ family: "b", tsMinute: 120, op: "hit", count: 1 },
			{ family: "b", tsMinute: 120, op: "miss", count: 1 },
		]);
		const totals = totalsFromSummaries(summaries);
		expect(hitRateLabel(totals.hit, totals.miss)).toBe("83.3%");
	});

	it("keeps admin:family metrics out of user hit-rate totals", () => {
		const summaries = summarizeFamilyOps([
			{ family: "settings:all", tsMinute: 60, op: "hit", count: 4 },
			{ family: "settings:all", tsMinute: 60, op: "miss", count: 1 },
			{ family: "admin:settings:all", tsMinute: 60, op: "kv-get", count: 9 },
			{ family: "admin:settings:all", tsMinute: 60, op: "load", count: 3 },
		]);
		expect(summaries.map((s) => s.family)).toEqual(["settings:all"]);
		const totals = totalsFromSummaries(summaries);
		expect(hitRateLabel(totals.hit, totals.miss)).toBe("80.0%");
		expect(totals["kv-get"]).toBe(0);
	});

	it("keeps application:d1 and admin:d1 out of user hit-rate totals", () => {
		const summaries = summarizeFamilyOps([
			{ family: "settings:all", tsMinute: 60, op: "hit", count: 2 },
			{ family: "settings:all", tsMinute: 60, op: "miss", count: 2 },
			{ family: "application:d1", tsMinute: 60, op: "d1-query", count: 40 },
			{ family: "application:d1", tsMinute: 60, op: "d1-rows-read", count: 900 },
			{ family: "admin:d1", tsMinute: 60, op: "d1-rows-written", count: 12 },
		]);
		expect(summaries.map((s) => s.family)).toEqual(["settings:all"]);
		expect(
			hitRateLabel(totalsFromSummaries(summaries).hit, totalsFromSummaries(summaries).miss),
		).toBe("50.0%");
	});

	it("does not invent D1 row counts when only query/duration were recorded", () => {
		const observed = summarizeD1Observation(
			[
				{ family: "application:d1", tsMinute: 60, op: "d1-query", count: 3 },
				{ family: "application:d1", tsMinute: 60, op: "d1-duration-ms", count: 12 },
				{ family: "admin:d1", tsMinute: 60, op: "d1-rows-read", count: 99 },
			],
			"application:d1",
		);
		expect(observed.queries).toBe(3);
		expect(observed.durationMs).toBe(12);
		expect(observed.rowsRead).toBeNull();
		expect(observed.rowsWritten).toBeNull();
		const withRows = summarizeD1Observation(
			[{ family: "application:d1", tsMinute: 120, op: "d1-rows-read", count: 7 }],
			"application:d1",
		);
		expect(withRows.rowsRead).toBe(7);
	});

	it("does not sum occupancy buckets; missing hours stay gaps", () => {
		const points = [
			{
				tsMinute: 60,
				liveEntries: 2,
				staleEntries: 0,
				contentBytes: 10,
				kind: "observed" as const,
			},
			{
				tsMinute: 180,
				liveEntries: 5,
				staleEntries: 1,
				contentBytes: 40,
				kind: "observed" as const,
			},
		];
		expect(occupancyForWindow(points, "latest")?.contentBytes).toBe(40);
		expect(occupancyForWindow(points, "peak")?.contentBytes).toBe(40);
		expect(insertGapPoints(points)).toEqual([points[0], { tsMinute: 120 }, points[1]]);
		expect(occupancyForWindow([], "latest")).toBeNull();
	});

	it("builds occupancy from overview without turning unknown bytes into 0", () => {
		const point = occupancyFromOverview(
			[
				{ count: 2, footprint: { kind: "observed", bytes: 100 } },
				{ count: 3, truncated: true, footprint: { kind: "unknown" } },
			],
			7_200_000,
		);
		expect(point.tsMinute).toBe(120);
		expect(point.liveEntries).toBe(5);
		expect(point.staleEntries).toBeNull();
		expect(point.contentBytes).toBe(100);
		expect(point.kind).toBe("at-least");
		const unknown = occupancyFromOverview([{ count: 1, footprint: { kind: "unknown" } }], 0);
		expect(unknown.contentBytes).toBeNull();
		expect(unknown.kind).toBe("unknown");
	});

	it("merges occupancy by hour instead of summing history", () => {
		const first = occupancyFromOverview(
			[{ count: 1, footprint: { kind: "observed", bytes: 10 } }],
			3_600_000,
		);
		const same = occupancyFromOverview(
			[{ count: 4, footprint: { kind: "observed", bytes: 40 } }],
			3_600_000,
		);
		const later = occupancyFromOverview(
			[{ count: 2, footprint: { kind: "observed", bytes: 20 } }],
			7_200_000,
		);
		const merged = mergeOccupancySnapshot(mergeOccupancySnapshot([first], same), later);
		expect(merged).toHaveLength(2);
		expect(merged[0].contentBytes).toBe(40);
		expect(merged[1].liveEntries).toBe(2);
	});

	it("builds occupancy from footprint gauges without summing hours or counting admin hits", () => {
		const points = occupancyFromMetrics([
			{ family: "footprint:thread:list", tsMinute: 60, op: "observed-keys", count: 4 },
			{ family: "footprint:thread:list", tsMinute: 60, op: "observed-keys", count: 9 },
			{ family: "footprint:thread:list", tsMinute: 60, op: "observed-bytes", count: 40 },
			{ family: "footprint:forum:tree:v2", tsMinute: 60, op: "observed-keys", count: 2 },
			{ family: "footprint:thread:list", tsMinute: 120, op: "observed-keys", count: 9 },
			{ family: "admin:monitor:overview", tsMinute: 60, op: "hit", count: 99 },
			{ family: "forum:tree:v2", tsMinute: 60, op: "hit", count: 3 },
		]);
		expect(points).toHaveLength(2);
		expect(points[0]).toMatchObject({
			tsMinute: 60,
			liveEntries: 11,
			contentBytes: 40,
			kind: "at-least",
		});
		expect(points[1].liveEntries).toBe(9);
		expect(isUserHitRateFamily("footprint:thread:list")).toBe(false);
		expect(isUserHitRateFamily("admin:monitor:overview")).toBe(false);
		expect(isUserHitRateFamily("forum:tree:v2")).toBe(true);
	});
});

describe("remaining and physical expiration", () => {
	it("keeps KV unix seconds separate from envelope ms", () => {
		expect(physicalExpirationMs(1_700_000_000)).toBe(1_700_000_000_000);
		expect(physicalExpirationMs(null)).toBeNull();
		expect(formatRemaining(null)).toBe("未知");
		expect(formatRemaining(0)).toBe("已过期");
		expect(formatRemaining(5_000)).toBe("5s");
	});
});

describe("scope labels", () => {
	it("marks internal as admin-only preview", () => {
		expect(formatScope("internal")).toContain("仅后台");
		expect(formatScope("public")).toBe("public");
		expect(formatScope(null)).toBe("未知");
	});
});

describe("cache mutation errors", () => {
	it("maps BUSY and stale rebuild failures to retry copy, not success", () => {
		expect(cacheMutationError({ code: "BUSY" })).toContain("稍后重试");
		expect(cacheMutationError({ code: "STALE_VERSION" })).toContain("未改写");
		expect(cacheMutationError({ code: "VALIDATION_FAILED" })).toContain("原快照");
	});
});

describe("mutation notices", () => {
	it("does not call a version bump a rebuild, and surfaces partial failure", () => {
		expect(mutationNotice({ outcome: "invalidated", label: " 版块树" }).text).toContain(
			"已切换版本",
		);
		expect(
			mutationNotice({ outcome: "rebuilt", label: " 此条", consistencyNote: "x" }).text,
		).toContain("已回填");
		expect(
			mutationNotice({ outcome: "deleted", label: " 此条", consistencyNote: "x" }).text,
		).toContain("已发送删除");
		const partial = mutationNotice({
			outcome: "partial",
			label: "刷新此条缓存",
			stage: "write",
			error: "KV 429",
		});
		expect(partial.type).toBe("error");
		expect(partial.text).toContain("部分成功");
		expect(partial.text).toContain("write");
		expect(mutationNotice({ outcome: "partial", label: "刷新" }).text).toBe("刷新部分成功");
		expect(mutationNotice({ outcome: "failed", label: "删除" }).text).toBe("删除失败");
		expect(mutationNotice({ outcome: "failed", label: "删除", error: "BUSY" }).text).toContain(
			"BUSY",
		);
	});
});

describe("ttl bytes remaining and lifecycle extras", () => {
	it("formats sticky/variable/legal tiers and leftover durations", () => {
		expect(formatTtl("sticky")).toBe("持续保留");
		expect(formatTtl("variable")).toBe("按业务设置");
		expect(formatTtl(60)).toContain("SHORT");
		expect(formatTtl(1800)).toContain("MEDIUM");
		expect(formatTtl(86400)).toContain("LONG");
		expect(formatTtl(90_000)).toBe("1d");
		expect(formatTtl(7200)).toBe("2h");
		expect(formatTtl(120)).toBe("2m");
		expect(formatTtl(15)).toBe("15s");
		expect(contentUtf8Bytes("abc")).toBe(3);
	});

	it("formats byte sizes and estimated footprints", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(2048)).toBe("2.0 KiB");
		expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MiB");
		expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GiB");
		expect(
			formatFootprint({ kind: "estimated", bytes: 4096, sampleSize: 3, scanComplete: true }),
		).toContain("完整扫描");
		expect(formatRemaining(90_000_000)).toBe("1d");
		expect(formatRemaining(7_200_000)).toBe("2h");
		expect(formatRemaining(120_000)).toBe("2m");
		expect(formatTimestamp(null, 0)).toBe("未知");
		expect(formatTimestamp(1_000, 2_000)).toContain("已过期");
		expect(formatTimestamp(10_000, 1_000)).toContain("还剩");
	});

	it("keeps restricted and read-failed states ahead of version checks", () => {
		const now = 10;
		expect(
			classifyLifecycle({
				found: true,
				enrolled: true,
				expiresAt: now + 1,
				now,
				readFailed: true,
			}),
		).toBe("read-failed");
		expect(
			classifyLifecycle({
				found: true,
				enrolled: true,
				expiresAt: now + 1,
				now,
				restricted: true,
			}),
		).toBe("restricted");
		expect(LIFECYCLE_LABEL["read-failed"]).toBe("读取失败");
		expect(sensitiveValueLabel("no-read")).toContain("不可读");
		expect(sensitiveValueLabel("mask-value")).toContain("已遮蔽");
		expect(sensitiveValueLabel("public")).toBeNull();
		expect(
			canPreviewValue({
				nameSensitivity: "hide",
				valueSensitivity: "public",
				rawKey: "k",
			}),
		).toBe(false);
		expect(
			canPreviewValue({
				nameSensitivity: "public",
				valueSensitivity: "no-read",
				rawKey: "k",
			}),
		).toBe(false);
		expect(
			canPreviewValue({
				nameSensitivity: "public",
				valueSensitivity: "public",
				rawKey: null,
			}),
		).toBe(false);
		expect(
			canPreviewValue({
				nameSensitivity: "public",
				valueSensitivity: "public",
				rawKey: "k",
			}),
		).toBe(true);
	});
});

describe("D1 observation points and mutation error fallbacks", () => {
	it("buckets query duration and optional row counts including admin:d1", () => {
		const points = d1ObservationPoints(
			[
				{ family: "application:d1", tsMinute: 120, op: "d1-query", count: 1 },
				{ family: "application:d1", tsMinute: 120, op: "d1-duration-ms", count: 4 },
				{ family: "application:d1", tsMinute: 120, op: "d1-rows-read", count: 8 },
				{ family: "application:d1", tsMinute: 120, op: "d1-rows-written", count: 3 },
				{ family: "admin:d1", tsMinute: 120, op: "d1-query", count: 9 },
			],
			"application:d1",
		);
		expect(points).toEqual([
			{ tsMinute: 120, queries: 1, durationMs: 4, rowsRead: 8, rowsWritten: 3 },
		]);
		expect(d1ObservationPoints([], "admin:d1")).toEqual([]);
		expect(
			summarizeD1Observation(
				[{ family: "admin:d1", tsMinute: 60, op: "d1-rows-written", count: 2 }],
				"admin:d1",
			).rowsWritten,
		).toBe(2);
	});

	it("includes admin families when asked and sorts equal reads by name", () => {
		const rows = summarizeFamilyOps(
			[
				{ family: "zeta", tsMinute: 60, op: "read", count: 2 },
				{ family: "alpha", tsMinute: 60, op: "read", count: 2 },
				{ family: "admin:x", tsMinute: 60, op: "hit", count: 5 },
			],
			{ includeAdmin: true },
		);
		expect(rows.map((row) => row.family)).toEqual(["admin:x", "alpha", "zeta"]);
		expect(rows.some((row) => row.family === "admin:x" && row.hit === 5)).toBe(true);
	});

	it("maps leftover mutation codes and peak occupancy when later buckets shrink", () => {
		expect(cacheMutationError({ message: "boom" })).toBe("boom");
		expect(cacheMutationError({ message: "boom" }, "load")).toBe("boom（load）");
		expect(cacheMutationError({ code: "NOPE" })).toBe("NOPE");
		expect(cacheMutationError({ code: "NOPE" }, "write")).toBe("NOPE（write）");
		expect(cacheMutationError()).toContain("请重试");
		const peak = occupancyForWindow(
			[
				{
					tsMinute: 60,
					liveEntries: 9,
					staleEntries: null,
					contentBytes: 90,
					kind: "observed",
				},
				{
					tsMinute: 120,
					liveEntries: 1,
					staleEntries: null,
					contentBytes: 10,
					kind: "observed",
				},
			],
			"peak",
		);
		expect(peak?.tsMinute).toBe(60);
		expect(
			occupancyFromMetrics([
				{ family: "footprint:a", tsMinute: 60, op: "observed-expired", count: 3 },
				{ family: "footprint:a", tsMinute: 60, op: "observed-expired", count: 1 },
			])[0].staleEntries,
		).toBe(3);
	});

	it("keeps remainingMs unknown, estimated overview bytes observed, and gaps only when hours skip", () => {
		expect(remainingMs(null, 10)).toBeNull();
		expect(remainingMs(25, 10)).toBe(15);
		expect(contentUtf8Bytes(undefined)).toBe(contentUtf8Bytes("null"));
		expect(
			occupancyFromOverview(
				[
					{
						count: 2,
						footprint: { kind: "estimated", bytes: 9, sampleSize: 1, scanComplete: true },
					},
				],
				0,
			).kind,
		).toBe("observed");
		expect(occupancyFromOverview([], 0).kind).toBe("unknown");
		expect(
			occupancyForWindow(
				[
					{
						tsMinute: 60,
						liveEntries: 2,
						staleEntries: null,
						contentBytes: null,
						kind: "at-least",
					},
					{
						tsMinute: 120,
						liveEntries: 8,
						staleEntries: null,
						contentBytes: null,
						kind: "at-least",
					},
				],
				"peak",
			)?.liveEntries,
		).toBe(8);
		expect(insertGapPoints([{ tsMinute: 240 }, { tsMinute: 300 }])).toEqual([
			{ tsMinute: 240 },
			{ tsMinute: 300 },
		]);
		expect(
			occupancyFromMetrics([
				{ family: "footprint:a", tsMinute: 60, op: "observed-current", count: 9 },
			])[0],
		).toMatchObject({ liveEntries: null, contentBytes: null, kind: "unknown" });
	});
});

describe("compact observation totals", () => {
	it("derives reads per hour without duplicating legacy or mixed samples", () => {
		const series = (
			[
				[60, "hit", 8],
				[60, "miss", 2],
				[120, "read", 5],
				[120, "hit", 8],
				[120, "miss", 2],
				[180, "read", 12],
				[180, "hit", 8],
			] as const
		).map(([tsMinute, op, count]) => ({ family: "thread:entity", tsMinute, op, count }));
		expect(totalsFromSummaries(summarizeFamilyOps(series)).read).toBe(32);
	});
});
