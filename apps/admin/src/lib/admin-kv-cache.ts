// Pure helpers for the Admin KV cache-management UI (docs/20 §8).
// No network. No Cloudflare Analytics. Unknown values stay unknown.

import type { CacheTier } from "@ellie/types";

export const MONITOR_POLL_MS = 60_000;
export const COUNTDOWN_TICK_MS = 1_000;

export type { CacheTier };

export type CacheLifecycle =
	| "valid"
	| "stale-version"
	| "logically-expired"
	| "not-found"
	| "not-enrolled"
	| "read-failed"
	| "restricted"
	| "runtime-state"
	| "diagnostic-snapshot";

export type FootprintKind = "observed" | "at-least" | "estimated" | "unknown";

export type Footprint =
	| { kind: "observed"; bytes: number }
	| { kind: "at-least"; bytes: number }
	| { kind: "estimated"; bytes: number; sampleSize: number; scanComplete: boolean }
	| { kind: "unknown" };

export type CountKind = "observed" | "at-least" | "unknown";

export const TIER_SECONDS: Record<CacheTier, number> = {
	SHORT: 60,
	MEDIUM: 1800,
	LONG: 86400,
};

export const LIFECYCLE_LABEL: Record<CacheLifecycle, string> = {
	valid: "有效",
	"stale-version": "旧版本",
	"logically-expired": "逻辑过期",
	"not-found": "未找到",
	"not-enrolled": "尚未接入",
	"read-failed": "读取失败",
	restricted: "受限",
	"runtime-state": "运行状态，不可操作",
	"diagnostic-snapshot": "诊断快照",
};

const UTF8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
	return UTF8.encode(value).byteLength;
}

export function contentUtf8Bytes(value: unknown): number {
	if (typeof value === "string") return utf8ByteLength(value);
	return utf8ByteLength(JSON.stringify(value) ?? "null");
}

export function tierFromTtl(ttl: number | "sticky" | "variable"): CacheTier | null {
	if (ttl === 60) return "SHORT";
	if (ttl === 1800) return "MEDIUM";
	if (ttl === 86400) return "LONG";
	return null;
}

export function formatTtl(ttl: number | "sticky" | "variable"): string {
	if (ttl === "sticky") return "持续保留";
	if (ttl === "variable") return "按业务设置";
	const tier = tierFromTtl(ttl);
	if (tier === "SHORT") return "SHORT · 60s";
	if (tier === "MEDIUM") return "MEDIUM · 30m";
	if (tier === "LONG") return "LONG · 24h";
	if (ttl >= 86400) return `${Math.round(ttl / 86400)}d`;
	if (ttl >= 3600) return `${Math.round(ttl / 3600)}h`;
	if (ttl >= 60) return `${Math.round(ttl / 60)}m`;
	return `${ttl}s`;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

export function formatFootprint(fp: Footprint): string {
	if (fp.kind === "unknown") return "未知";
	const size = formatBytes(fp.bytes);
	if (fp.kind === "observed") return `已观察 ${size}`;
	if (fp.kind === "at-least") return `至少 ${size}`;
	const coverage = fp.scanComplete ? "完整扫描" : "采样";
	return `估算 ${size}（${coverage}，样本 ${fp.sampleSize}）`;
}

export function formatCount(count: number | null, kind: CountKind): string {
	if (kind === "unknown" || count === null) return "未知";
	const n = count.toLocaleString("zh-CN");
	if (kind === "at-least") return `至少 ${n}`;
	return `已发现 ${n}`;
}

export function remainingMs(expiresAt: number | null, now: number): number | null {
	if (expiresAt === null) return null;
	return expiresAt - now;
}

export function formatRemaining(ms: number | null): string {
	if (ms === null) return "未知";
	if (ms <= 0) return "已过期";
	const sec = Math.floor(ms / 1000);
	if (sec >= 86400) return `${Math.round(sec / 86400)}d`;
	if (sec >= 3600) return `${Math.round(sec / 3600)}h`;
	if (sec >= 60) return `${Math.round(sec / 60)}m`;
	return `${sec}s`;
}

/** `expiration` is KV unix seconds; `expiresAt` is envelope epoch ms. */
export function formatTimestamp(epochMs: number | null, now: number): string {
	if (epochMs === null) return "未知";
	const stamp = new Date(epochMs).toLocaleString();
	const rest = formatRemaining(epochMs - now);
	return rest === "已过期" ? `${stamp}（已过期）` : `${stamp} · 还剩 ${rest}`;
}

export function physicalExpirationMs(expirationUnixSec: number | null): number | null {
	return expirationUnixSec === null ? null : expirationUnixSec * 1000;
}

export function classifyLifecycle(input: {
	found: boolean;
	enrolled: boolean;
	restricted?: boolean;
	runtimeState?: boolean;
	readFailed?: boolean;
	expiresAt: number | null;
	now: number;
	entryVersion?: string | null;
	currentVersion?: string | null;
}): CacheLifecycle {
	if (input.readFailed) return "read-failed";
	if (input.runtimeState) return "runtime-state";
	if (input.restricted) return "restricted";
	if (!input.enrolled) return "not-enrolled";
	if (!input.found) return "not-found";
	if (input.entryVersion && input.currentVersion && input.entryVersion !== input.currentVersion) {
		return input.expiresAt !== null && input.expiresAt <= input.now
			? "diagnostic-snapshot"
			: "stale-version";
	}
	if (input.expiresAt !== null && input.expiresAt <= input.now) {
		return "logically-expired";
	}
	return "valid";
}

export function shouldAutoPoll(input: {
	visible: boolean;
	lastFetchedAt: number | null;
	now: number;
	minIntervalMs?: number;
}): boolean {
	if (!input.visible) return false;
	if (input.lastFetchedAt === null) return true;
	return input.now - input.lastFetchedAt >= (input.minIntervalMs ?? MONITOR_POLL_MS);
}

export function hitRateLabel(hit: number, miss: number): string {
	const denom = hit + miss;
	if (denom === 0) return "无请求";
	return `${((hit / denom) * 100).toFixed(1)}%`;
}

export type KvOp =
	| "read"
	| "hit"
	| "miss"
	| "write"
	| "bump"
	| "delete"
	| "error"
	| "load"
	| "kv-get"
	| "kv-put"
	| "kv-delete"
	| "load-error"
	| "write-error"
	| "invalidate-error"
	| "d1-query"
	| "d1-rows-read"
	| "d1-rows-written"
	| "d1-duration-ms"
	| "observed-keys"
	| "observed-bytes"
	| "observed-expired"
	| "observed-current";

export function isAdminMetricFamily(family: string): boolean {
	return family.startsWith("admin:");
}

export function isD1ObservationFamily(family: string): boolean {
	return family === "application:d1" || family === "admin:d1";
}

export function isFootprintFamily(family: string): boolean {
	return family.startsWith("footprint:");
}

export function isUserHitRateFamily(family: string): boolean {
	return (
		!isAdminMetricFamily(family) && !isD1ObservationFamily(family) && !isFootprintFamily(family)
	);
}

export interface KvMetricRow {
	family: string;
	tsMinute: number;
	op: KvOp;
	count: number;
}

export interface FamilyOpSummary {
	family: string;
	read: number;
	hit: number;
	miss: number;
	write: number;
	bump: number;
	delete: number;
	error: number;
	load: number;
	"kv-get": number;
	"kv-put": number;
	"kv-delete": number;
	"load-error": number;
	"write-error": number;
	"invalidate-error": number;
}

function emptySummary(family: string): FamilyOpSummary {
	return {
		family,
		read: 0,
		hit: 0,
		miss: 0,
		write: 0,
		bump: 0,
		delete: 0,
		error: 0,
		load: 0,
		"kv-get": 0,
		"kv-put": 0,
		"kv-delete": 0,
		"load-error": 0,
		"write-error": 0,
		"invalidate-error": 0,
	};
}

export function summarizeFamilyOps(
	series: KvMetricRow[],
	opts: { includeAdmin?: boolean } = {},
): FamilyOpSummary[] {
	const byFamily = new Map<string, FamilyOpSummary>();
	for (const r of series) {
		if (!opts.includeAdmin && !isUserHitRateFamily(r.family)) continue;
		let s = byFamily.get(r.family);
		if (!s) {
			s = emptySummary(r.family);
			byFamily.set(r.family, s);
		}
		const field = r.op as keyof FamilyOpSummary;
		if (field !== "family" && typeof s[field] === "number") s[field] += r.count;
	}
	return [...byFamily.values()].sort((a, b) => b.read - a.read || a.family.localeCompare(b.family));
}

export function totalsFromSummaries(summaries: FamilyOpSummary[]): FamilyOpSummary {
	return summaries.reduce(
		(acc, s) => ({
			family: "*",
			read: acc.read + s.read,
			hit: acc.hit + s.hit,
			miss: acc.miss + s.miss,
			write: acc.write + s.write,
			bump: acc.bump + s.bump,
			delete: acc.delete + s.delete,
			error: acc.error + s.error,
			load: acc.load + s.load,
			"kv-get": acc["kv-get"] + s["kv-get"],
			"kv-put": acc["kv-put"] + s["kv-put"],
			"kv-delete": acc["kv-delete"] + s["kv-delete"],
			"load-error": acc["load-error"] + s["load-error"],
			"write-error": acc["write-error"] + s["write-error"],
			"invalidate-error": acc["invalidate-error"] + s["invalidate-error"],
		}),
		emptySummary("*"),
	);
}

export interface D1Observation {
	family: "application:d1" | "admin:d1";
	queries: number;
	durationMs: number;
	rowsRead: number | null;
	rowsWritten: number | null;
}

export function summarizeD1Observation(
	series: KvMetricRow[],
	family: "application:d1" | "admin:d1" = "application:d1",
): D1Observation {
	let queries = 0;
	let durationMs = 0;
	let rowsRead: number | null = null;
	let rowsWritten: number | null = null;
	for (const row of series) {
		if (row.family !== family) continue;
		if (row.op === "d1-query") queries += row.count;
		else if (row.op === "d1-duration-ms") durationMs += row.count;
		else if (row.op === "d1-rows-read") rowsRead = (rowsRead ?? 0) + row.count;
		else if (row.op === "d1-rows-written") rowsWritten = (rowsWritten ?? 0) + row.count;
	}
	return { family, queries, durationMs, rowsRead, rowsWritten };
}

export function d1ObservationPoints(
	series: KvMetricRow[],
	family: "application:d1" | "admin:d1" = "application:d1",
) {
	const buckets = new Map<
		number,
		{
			tsMinute: number;
			queries: number;
			durationMs: number;
			rowsRead?: number;
			rowsWritten?: number;
		}
	>();
	for (const row of series) {
		if (row.family !== family) continue;
		const bucket = buckets.get(row.tsMinute) ?? {
			tsMinute: row.tsMinute,
			queries: 0,
			durationMs: 0,
		};
		if (row.op === "d1-query") bucket.queries += row.count;
		else if (row.op === "d1-duration-ms") bucket.durationMs += row.count;
		else if (row.op === "d1-rows-read") bucket.rowsRead = (bucket.rowsRead ?? 0) + row.count;
		else if (row.op === "d1-rows-written")
			bucket.rowsWritten = (bucket.rowsWritten ?? 0) + row.count;
		buckets.set(row.tsMinute, bucket);
	}
	return [...buckets.values()].sort((a, b) => a.tsMinute - b.tsMinute);
}

export function formatScope(scope: string | null | undefined): string {
	if (!scope) return "未知";
	if (scope === "internal") return "internal（仅后台可预览）";
	return scope;
}

/** Occupancy is a gauge: last/peak in the window, never a sum of buckets. */
export interface OccupancyPoint {
	tsMinute: number;
	liveEntries: number | null;
	staleEntries: number | null;
	contentBytes: number | null;
	kind: FootprintKind;
}

export function occupancyFromOverview(
	rows: Array<{
		count: number;
		truncated?: boolean;
		countKind?: CountKind;
		footprint?: Footprint;
	}>,
	observedAt: number,
): OccupancyPoint {
	const liveEntries = rows.reduce((n, r) => n + r.count, 0);
	const truncated = rows.some((r) => r.truncated || r.countKind === "at-least");
	let summed = 0;
	let sawBytes = false;
	let sawUnknown = false;
	for (const row of rows) {
		if (!row.footprint || row.footprint.kind === "unknown") {
			sawUnknown = true;
			continue;
		}
		sawBytes = true;
		summed += row.footprint.bytes;
	}
	const kind: FootprintKind = !sawBytes
		? "unknown"
		: sawUnknown || truncated
			? "at-least"
			: "observed";
	return {
		tsMinute: Math.floor(observedAt / 60_000),
		liveEntries,
		staleEntries: null,
		contentBytes: sawBytes ? summed : null,
		kind,
	};
}

export function mergeOccupancySnapshot(
	prev: OccupancyPoint[],
	next: OccupancyPoint,
): OccupancyPoint[] {
	const existing = prev.findIndex((p) => p.tsMinute === next.tsMinute);
	if (existing >= 0) {
		const copy = prev.slice();
		copy[existing] = next;
		return copy;
	}
	return [...prev, next].sort((a, b) => a.tsMinute - b.tsMinute);
}

function emptyOccupancy(tsMinute: number): OccupancyPoint {
	return { tsMinute, liveEntries: null, staleEntries: null, contentBytes: null, kind: "unknown" };
}

function peakGauge(point: OccupancyPoint, op: string, count: number): OccupancyPoint {
	if (op === "observed-keys") {
		point.liveEntries = Math.max(point.liveEntries ?? 0, count);
		point.kind = "at-least";
	} else if (op === "observed-bytes") {
		point.contentBytes = Math.max(point.contentBytes ?? 0, count);
		point.kind = "at-least";
	} else if (op === "observed-expired") {
		point.staleEntries = Math.max(point.staleEntries ?? 0, count);
	}
	return point;
}

function addFamilyOccupancy(bucket: OccupancyPoint, point: OccupancyPoint): OccupancyPoint {
	if (point.liveEntries !== null)
		bucket.liveEntries = (bucket.liveEntries ?? 0) + point.liveEntries;
	if (point.contentBytes !== null)
		bucket.contentBytes = (bucket.contentBytes ?? 0) + point.contentBytes;
	if (point.staleEntries !== null)
		bucket.staleEntries = (bucket.staleEntries ?? 0) + point.staleEntries;
	if (point.kind !== "unknown") bucket.kind = "at-least";
	return bucket;
}

/** Occupancy trend from persisted gauges. Per-family peaks (MAX), never summed across minutes or isolates. */
export function occupancyFromMetrics(series: KvMetricRow[]): OccupancyPoint[] {
	const perFamily = new Map<string, OccupancyPoint>();
	for (const row of series) {
		if (!isFootprintFamily(row.family)) continue;
		const key = `${row.tsMinute}\0${row.family}`;
		perFamily.set(
			key,
			peakGauge(perFamily.get(key) ?? emptyOccupancy(row.tsMinute), row.op, row.count),
		);
	}
	const buckets = new Map<number, OccupancyPoint>();
	for (const point of perFamily.values()) {
		buckets.set(
			point.tsMinute,
			addFamilyOccupancy(buckets.get(point.tsMinute) ?? emptyOccupancy(point.tsMinute), point),
		);
	}
	return [...buckets.values()].sort((a, b) => a.tsMinute - b.tsMinute);
}

export function occupancyForWindow(
	points: OccupancyPoint[],
	mode: "latest" | "peak" = "latest",
): OccupancyPoint | null {
	const known = points.filter((p) => p.contentBytes !== null || p.liveEntries !== null);
	if (known.length === 0) return null;
	if (mode === "latest") return known[known.length - 1];
	return known.reduce((best, p) => {
		const b = best.contentBytes ?? best.liveEntries ?? 0;
		const n = p.contentBytes ?? p.liveEntries ?? 0;
		return n > b ? p : best;
	});
}

export function insertGapPoints<T extends { tsMinute: number }>(
	points: T[],
): Array<T | { tsMinute: number }> {
	const out: Array<T | { tsMinute: number }> = [];
	for (let i = 0; i < points.length; i++) {
		if (i > 0 && points[i].tsMinute > points[i - 1].tsMinute + 1) {
			out.push({ tsMinute: points[i - 1].tsMinute + 1 });
		}
		out.push(points[i]);
	}
	return out;
}

export type MutationOutcome = "rebuilt" | "deleted" | "invalidated" | "partial" | "failed";

export function cacheMutationError(
	error?: { code?: string; message?: string } | null,
	stage?: string,
): string {
	if (error?.code === "BUSY") return "缓存装载尚未结束，请稍后重试";
	if (error?.code === "STALE_VERSION") return "该条目已是旧版本，未改写仍有效的快照";
	if (error?.code === "VALIDATION_FAILED") return "装载期间资源版本已变化，仍保留原快照";
	if (error?.message) return stage ? `${error.message}（${stage}）` : error.message;
	if (error?.code) return stage ? `${error.code}（${stage}）` : error.code;
	return "操作失败，请重试";
}

export function mutationNotice(input: {
	outcome: MutationOutcome;
	label: string;
	stage?: string;
	error?: string;
	consistencyNote?: string;
}): { type: "success" | "error"; text: string } {
	if (input.outcome === "failed") {
		return {
			type: "error",
			text: input.error ? `${input.label}失败：${input.error}` : `${input.label}失败`,
		};
	}
	if (input.outcome === "partial") {
		const stage = input.stage ? `（完成到 ${input.stage}）` : "";
		return {
			type: "error",
			text: `${input.label}部分成功${stage}${input.error ? `：${input.error}` : ""}`,
		};
	}
	const note = input.consistencyNote ? " 其他地区可能尚未可见。" : "";
	const verb =
		input.outcome === "rebuilt"
			? "已回填"
			: input.outcome === "deleted"
				? "已发送删除"
				: "已切换版本";
	return { type: "success", text: `${verb}${input.label}${note}` };
}

export function canPreviewValue(input: {
	nameSensitivity: string;
	valueSensitivity: string;
	rawKey: string | null;
}): boolean {
	return (
		input.nameSensitivity !== "hide" &&
		input.valueSensitivity !== "no-read" &&
		input.rawKey !== null
	);
}

export function sensitiveValueLabel(valueSensitivity: string): string | null {
	if (valueSensitivity === "no-read") return "敏感，不可读";
	if (valueSensitivity === "mask-value") return "敏感，已遮蔽";
	return null;
}

export type MetricsWindowMinutes = 60 | 1440 | 10080;

export const METRICS_WINDOWS: { minutes: MetricsWindowMinutes; label: string }[] = [
	{ minutes: 60, label: "近 60 分钟" },
	{ minutes: 1440, label: "近 24 小时" },
	{ minutes: 10080, label: "近 7 天" },
];
