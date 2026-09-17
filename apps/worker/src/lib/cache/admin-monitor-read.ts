import type { CacheDescriptor, CacheTier } from "@ellie/types";
import type { Env } from "../env";
import { dataCacheKey } from "./keys";
import { KV_REGISTRY, type KvFamilySpec, resolveFamilyForKey } from "./kv-registry";
import { cacheGetOrSet } from "./wrap";

export const OVERVIEW_HARD_CAP = 1000;
export const OVERVIEW_SAMPLE_SIZE = 5;
export const EXACT_SIBLING_SCAN = 32;
const EXACT_MAX_PAGES = 4;
const OVERVIEW_CONCURRENCY = 4;
export const METRICS_MINUTES_MIN = 60;
export const METRICS_MINUTES_MAX = 10_080;
export const METRICS_RECENT_MAX = 60;
export const METRICS_ROW_CAP = 4000;
export const FOOTPRINT_PREFIX = "footprint:";
export const FOOTPRINT_OPS = [
	"observed-keys",
	"observed-bytes",
	"observed-expired",
	"observed-current",
] as const;

type Presence =
	| "present"
	| "absent"
	| "planned"
	| "historical"
	| "dead-builder-reserved"
	| "sensitive-hidden";

export type MonitorFootprint = {
	kind: "observed" | "at-least" | "estimated" | "unknown";
	bytes: number | null;
};

export interface MonitorOverviewRow {
	family: string;
	displayName: string;
	category: string;
	status: string;
	pattern: string;
	ttl: number | "sticky" | "variable";
	tier: CacheTier | null;
	nameSensitivity: string;
	valueSensitivity: string;
	count: number;
	countKind: "observed" | "at-least" | "unknown";
	truncated: boolean;
	presence: Presence;
	currentGens?: { name: string; value: string | null }[];
	sampleKeys: string[];
	footprint: MonitorFootprint;
	expiredCount: number | null;
	currentVersionCount: number | null;
	actions: {
		inspect: boolean;
		rebuild: boolean;
		deleteEntry: boolean;
		invalidateGroup: boolean;
		restriction: string | null;
	};
}

export interface MonitorOverview {
	families: MonitorOverviewRow[];
	observedAt: number;
	source: string;
}

export interface MonitorMetricRow {
	family: string;
	tsMinute: number;
	op: string;
	count: number;
}

export interface MonitorMetrics {
	family: string | null;
	minutes: number;
	series: MonitorMetricRow[];
	observedAt: number;
	source: string;
	truncated: boolean;
	coverage: "complete" | "partial";
	intervalMinutes: 60;
	sampling: "best-effort";
}

function tierFromTtl(ttl: KvFamilySpec["ttl"]): CacheTier | null {
	if (ttl === 60) return "SHORT";
	if (ttl === 1800) return "MEDIUM";
	if (ttl === 86400) return "LONG";
	return null;
}

function classifyPresence(spec: KvFamilySpec, count: number): Presence {
	if (spec.nameSensitivity === "hide" && spec.status === "shipped") {
		return count > 0 ? "sensitive-hidden" : "absent";
	}
	if (spec.status === "planned") return "planned";
	if (spec.status === "historical") return "historical";
	if (spec.status === "dead-builder-reserved") return "dead-builder-reserved";
	return count > 0 ? "present" : "absent";
}

function isRuntimeFamily(spec: KvFamilySpec): boolean {
	return (
		spec.category === "session" ||
		spec.category === "rate-limit" ||
		spec.category === "throttle" ||
		spec.category === "gen" ||
		spec.category === "sticky-stats"
	);
}

function familyActions(spec: KvFamilySpec): MonitorOverviewRow["actions"] {
	const hide = spec.nameSensitivity === "hide";
	const shipped = spec.status === "shipped";
	return {
		inspect: !hide,
		rebuild: shipped && !!spec.tier && !!spec.loader,
		deleteEntry: !!spec.tier && shipped && spec.valueSensitivity !== "no-read" && !hide,
		invalidateGroup: spec.refresh.kind.startsWith("bump-"),
		restriction: isRuntimeFamily(spec)
			? "runtime-state"
			: hide
				? "name-hidden"
				: spec.valueSensitivity === "no-read"
					? "value-forbidden"
					: shipped
						? null
						: spec.status,
	};
}

function readListMetadata(entry: { metadata?: unknown; expiration?: number }): {
	contentUtf8Bytes: number | null;
	expiresAt: number | null;
} {
	const meta = entry.metadata;
	if (!meta || typeof meta !== "object") {
		return { contentUtf8Bytes: null, expiresAt: null };
	}
	const o = meta as Record<string, unknown>;
	const sizeBytes = typeof o.sizeBytes === "number" ? o.sizeBytes : null;
	const contentUtf8Bytes = typeof o.contentUtf8Bytes === "number" ? o.contentUtf8Bytes : sizeBytes;
	const expiresAt = typeof o.expiresAt === "number" ? o.expiresAt : null;
	return { contentUtf8Bytes, expiresAt };
}

async function shortHash(input: string): Promise<string> {
	const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	const bytes = new Uint8Array(buf);
	return `${bytes[0].toString(16).padStart(2, "0")}${bytes[1].toString(16).padStart(2, "0")}${bytes[2].toString(16).padStart(2, "0")}`;
}

function maskIpSuffix(suffix: string): string {
	if (suffix.includes(".")) {
		const parts = suffix.split(".");
		if (parts.length === 4) return `${parts[0]}.${parts[1]}.*.*`;
	}
	if (suffix.includes(":")) {
		const parts = suffix.split(":");
		if (parts.length >= 4) return `${parts.slice(0, 4).join(":")}::*`;
	}
	return "***";
}

async function maskKeyName(key: string, family: KvFamilySpec): Promise<string> {
	if (family.nameSensitivity === "public") return key;
	if (family.nameSensitivity === "hide") return "[hidden]";
	const suffix = key.slice(family.listPrefix.length);
	if (suffix.length === 0) return key;
	if (
		family.family === "login-ip" ||
		family.family === "login-lockout-ip" ||
		family.family === "reg-ip" ||
		family.family === "chk-usr-ip"
	) {
		return `${family.listPrefix}${maskIpSuffix(suffix)}`;
	}
	if (
		family.family === "online:user" ||
		family.family === "activity_throttle" ||
		family.family === "email_verify" ||
		family.family === "email_verify_lock"
	) {
		return `${family.listPrefix}u_${await shortHash(suffix)}`;
	}
	return `${family.listPrefix}***`;
}

async function listMetadata(
	env: Env,
	prefix: string,
	hardCap: number,
): Promise<{
	keys: { name: string; expiration?: number; metadata?: unknown }[];
	truncated: boolean;
}> {
	const out: { name: string; expiration?: number; metadata?: unknown }[] = [];
	let cursor: string | undefined;
	let pages = 0;
	const pageLimit = 1000;
	const maxPages = Math.max(1, Math.ceil(hardCap / pageLimit));
	while (pages < maxPages) {
		const result = await env.KV.list({ prefix, cursor, limit: pageLimit });
		for (const entry of result.keys) {
			out.push({ name: entry.name, expiration: entry.expiration, metadata: entry.metadata });
			if (out.length >= hardCap) return { keys: out, truncated: !result.list_complete };
		}
		if (result.list_complete) return { keys: out, truncated: false };
		cursor = result.cursor;
		pages++;
	}
	return { keys: out, truncated: true };
}

/** Bound both keys and requests: expired/deleted KV keys can leave empty incomplete pages. */
export async function listExactMetadata(
	env: Env,
	name: string,
): Promise<{
	key: { name: string; expiration?: number; metadata?: unknown } | null;
	truncated: boolean;
}> {
	let cursor: string | undefined;
	let scanned = 0;
	for (let page = 0; page < EXACT_MAX_PAGES && scanned < EXACT_SIBLING_SCAN; page++) {
		const result = await env.KV.list({
			prefix: name,
			cursor,
			limit: Math.min(32, EXACT_SIBLING_SCAN - scanned),
		});
		for (const entry of result.keys) {
			if (entry.name === name) return { key: entry, truncated: false };
		}
		scanned += result.keys.length;
		if (result.list_complete) return { key: null, truncated: false };
		cursor = result.cursor;
	}
	return { key: null, truncated: true };
}

export function monitorFamilyForMinutes(
	minutes: number,
): "monitor:metrics:recent" | "monitor:metrics:history" {
	return minutes <= METRICS_RECENT_MAX ? "monitor:metrics:recent" : "monitor:metrics:history";
}

function specOf(d: CacheDescriptor): { family: string; tier: CacheTier; keys: string[] } {
	if (d.family === "monitor:overview")
		return { family: "monitor:overview", tier: "MEDIUM", keys: ["resource"] };
	if (d.family === "monitor:metrics:recent" || d.family === "monitor:metrics:history") {
		return {
			family: d.family,
			tier: d.family === "monitor:metrics:recent" ? "SHORT" : "MEDIUM",
			keys: ["resource", "family", "minutes"],
		};
	}
	throw new TypeError("Unknown monitor family");
}

export function validateMonitorDescriptor(d: CacheDescriptor): { family: string; tier: CacheTier } {
	if (d.scope !== "admin") throw new TypeError("Admin scope is required");
	const spec = specOf(d);
	if (d.family !== spec.family) throw new TypeError("Monitor family does not match descriptor");
	const keys = Object.keys(d.params).sort().join(",");
	if (keys !== [...spec.keys].sort().join(",")) throw new TypeError("Invalid monitor dimensions");
	if (d.params.resource !== "overview" && d.params.resource !== "metrics")
		throw new TypeError("Invalid monitor resource");
	if (d.family === "monitor:overview") {
		if (d.params.resource !== "overview") throw new TypeError("Invalid monitor resource");
		return spec;
	}
	if (d.params.resource !== "metrics") throw new TypeError("Invalid monitor resource");
	const minutes = d.params.minutes;
	if (
		typeof minutes !== "number" ||
		!Number.isSafeInteger(minutes) ||
		minutes < METRICS_MINUTES_MIN ||
		minutes > METRICS_MINUTES_MAX
	) {
		throw new TypeError("Invalid metrics window");
	}
	if (d.family !== monitorFamilyForMinutes(minutes))
		throw new TypeError("Metrics family does not match window");
	if (
		d.params.family !== null &&
		(typeof d.params.family !== "string" ||
			d.params.family.length === 0 ||
			d.params.family.length > 128)
	) {
		throw new TypeError("Invalid metrics family");
	}
	return spec;
}

export async function monitorCacheKey(_env: Env, descriptor: CacheDescriptor): Promise<string> {
	validateMonitorDescriptor(descriptor);
	return dataCacheKey(descriptor.family, descriptor.params, descriptor.scope);
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOverviewRow(value: unknown): boolean {
	return (
		record(value) &&
		typeof value.family === "string" &&
		typeof value.count === "number" &&
		record(value.footprint)
	);
}

export function isMonitorCacheData(descriptor: CacheDescriptor, value: unknown): boolean {
	try {
		validateMonitorDescriptor(descriptor);
	} catch {
		return false;
	}
	if (!record(value) || typeof value.observedAt !== "number" || typeof value.source !== "string")
		return false;
	if (descriptor.family === "monitor:overview") {
		return Array.isArray(value.families) && value.families.every(isOverviewRow);
	}
	return (
		value.intervalMinutes === 60 &&
		value.sampling === "best-effort" &&
		value.source === "application:kv_cache_metrics_hour" &&
		value.family === descriptor.params.family &&
		value.minutes === descriptor.params.minutes &&
		(value.coverage === "complete" || value.coverage === "partial") &&
		typeof value.truncated === "boolean" &&
		Array.isArray(value.series) &&
		value.series.every(
			(row) =>
				record(row) &&
				typeof row.family === "string" &&
				Number.isSafeInteger(row.tsMinute) &&
				Number(row.tsMinute) % 60 === 0 &&
				typeof row.op === "string" &&
				typeof row.count === "number",
		)
	);
}

function footprintFromOwned(
	owned: { metadata?: unknown; expiration?: number }[],
	truncated: boolean,
	now: number,
): Pick<MonitorOverviewRow, "footprint" | "expiredCount" | "currentVersionCount"> {
	let observedBytes = 0;
	let keysWithBytes = 0;
	let expiredCount: number | null = null;
	// TTL / schema / stale flags are not resource epochs. Leave unknown.
	const currentVersionCount: number | null = null;
	for (const entry of owned) {
		const meta = readListMetadata(entry);
		if (meta.contentUtf8Bytes !== null) {
			observedBytes += meta.contentUtf8Bytes;
			keysWithBytes++;
		}
		if (meta.expiresAt !== null) {
			expiredCount = (expiredCount ?? 0) + (meta.expiresAt <= now ? 1 : 0);
		}
	}
	const footprint: MonitorFootprint =
		keysWithBytes === 0
			? { kind: "unknown", bytes: null }
			: truncated || keysWithBytes < owned.length
				? { kind: "at-least", bytes: observedBytes }
				: { kind: "observed", bytes: observedBytes };
	return { footprint, expiredCount, currentVersionCount };
}

async function overviewSamples(spec: KvFamilySpec, owned: { name: string }[]): Promise<string[]> {
	if (spec.nameSensitivity === "hide" || owned.length === 0) return [];
	return Promise.all(
		owned.slice(0, OVERVIEW_SAMPLE_SIZE).map((entry) => maskKeyName(entry.name, spec)),
	);
}

async function loadFamilyRow(
	env: Env,
	spec: KvFamilySpec,
	now: number,
): Promise<MonitorOverviewRow> {
	const listed =
		spec.keyKind === "exact"
			? await listExactMetadata(env, spec.listPrefix).then((found) => ({
					keys: found.key ? [found.key] : [],
					truncated: found.truncated,
					countKind: (found.truncated ? "unknown" : "observed") as MonitorOverviewRow["countKind"],
				}))
			: await listMetadata(env, spec.listPrefix, OVERVIEW_HARD_CAP).then((found) => ({
					keys: found.keys.filter(
						(entry) => resolveFamilyForKey(entry.name)?.family === spec.family,
					),
					truncated: found.truncated,
					countKind: (found.truncated ? "at-least" : "observed") as MonitorOverviewRow["countKind"],
				}));
	return {
		family: spec.family,
		displayName: spec.displayName,
		category: spec.category,
		status: spec.status,
		pattern: spec.pattern,
		ttl: spec.ttl,
		tier: spec.tier ?? tierFromTtl(spec.ttl),
		nameSensitivity: spec.nameSensitivity,
		valueSensitivity: spec.valueSensitivity,
		count: listed.keys.length,
		countKind: listed.countKind,
		truncated: listed.truncated,
		presence: classifyPresence(spec, listed.keys.length),
		currentGens: spec.genKeys?.map((name) => ({ name, value: null })),
		sampleKeys: await overviewSamples(spec, listed.keys),
		...footprintFromOwned(listed.keys, listed.truncated, now),
		actions: familyActions(spec),
	};
}

/** Pure registry + bounded KV.list metadata. No value GET, no gen seeding, no metrics writes. */
export async function loadMonitorOverview(env: Env): Promise<MonitorOverview> {
	const now = Date.now();
	const families: MonitorOverviewRow[] = [];
	// Serial KV latency across the registry exceeds the core's 20s load deadline.
	// Keep fan-out below Workers' six outgoing connections and preserve registry order.
	for (let offset = 0; offset < KV_REGISTRY.length; offset += OVERVIEW_CONCURRENCY) {
		const rows = await Promise.allSettled(
			KV_REGISTRY.slice(offset, offset + OVERVIEW_CONCURRENCY).map((spec) =>
				loadFamilyRow(env, spec, now),
			),
		);
		// Retain the origin permit until every started KV request has settled, even on failure.
		for (const row of rows) {
			if (row.status === "rejected") throw row.reason;
			families.push(row.value);
		}
	}
	return { families, observedAt: now, source: "registry+kv-list-metadata" };
}

/** Pure read of persisted, completed hourly observations. No business statistics SQL. */
export async function loadMonitorMetrics(
	env: Env,
	family: string | null,
	minutes: number,
): Promise<MonitorMetrics> {
	const currentHour = Math.floor(Date.now() / 3_600_000);
	const cutoff = currentHour - Math.ceil(minutes / 60);
	const limit = METRICS_ROW_CAP + 1;
	const result = family
		? await env.DB.prepare(
				`SELECT family, ts_hour, op, count
				 FROM kv_cache_metrics_hour
				 WHERE ts_hour >= ? AND ts_hour < ? AND family = ?
				 ORDER BY ts_hour ASC, op ASC
				 LIMIT ?`,
			)
				.bind(cutoff, currentHour, family, limit)
				.all<{ family: string; ts_hour: number; op: string; count: number }>()
		: await env.DB.prepare(
				`SELECT family, ts_hour, op, count
				 FROM kv_cache_metrics_hour
				 WHERE ts_hour >= ? AND ts_hour < ?
				 ORDER BY family ASC, ts_hour ASC, op ASC
				 LIMIT ?`,
			)
				.bind(cutoff, currentHour, limit)
				.all<{ family: string; ts_hour: number; op: string; count: number }>();
	if (!result.success || !Array.isArray(result.results))
		throw new Error("Monitor metrics could not be loaded");
	const truncated = result.results.length > METRICS_ROW_CAP;
	const rows = truncated ? result.results.slice(0, METRICS_ROW_CAP) : result.results;
	return {
		family,
		minutes,
		series: rows.map((row) => ({
			family: row.family,
			tsMinute: row.ts_hour * 60,
			op: row.op,
			count: row.count,
		})),
		observedAt: Date.now(),
		source: "application:kv_cache_metrics_hour",
		truncated,
		coverage: truncated ? "partial" : "complete",
		intervalMinutes: 60,
		sampling: "best-effort",
	};
}

export async function rebuildMonitorCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<unknown> {
	validateMonitorDescriptor(descriptor);
	if (descriptor.family === "monitor:overview") return loadMonitorOverview(env);
	return loadMonitorMetrics(
		env,
		descriptor.params.family === null ? null : String(descriptor.params.family),
		Number(descriptor.params.minutes),
	);
}

function descriptorForOverview(): CacheDescriptor {
	return { family: "monitor:overview", scope: "admin", params: { resource: "overview" } };
}

function descriptorForMetrics(family: string | null, minutes: number): CacheDescriptor {
	return {
		family: monitorFamilyForMinutes(minutes),
		scope: "admin",
		params: { resource: "metrics", family, minutes },
	};
}

export async function getMonitorOverview(
	env: Env,
	ctx: ExecutionContext | undefined,
): Promise<MonitorOverview> {
	const descriptor = descriptorForOverview();
	const spec = validateMonitorDescriptor(descriptor);
	return cacheGetOrSet(
		env,
		ctx,
		await monitorCacheKey(env, descriptor),
		() => loadMonitorOverview(env),
		{
			family: descriptor.family,
			tier: spec.tier,
			params: descriptor.params,
			scope: "admin",
			source: "admin",
			validator: (value): value is MonitorOverview => isMonitorCacheData(descriptor, value),
		},
	);
}

export async function getMonitorMetrics(
	env: Env,
	ctx: ExecutionContext | undefined,
	family: string | null,
	minutes: number,
): Promise<MonitorMetrics> {
	const descriptor = descriptorForMetrics(family, minutes);
	const spec = validateMonitorDescriptor(descriptor);
	return cacheGetOrSet(
		env,
		ctx,
		await monitorCacheKey(env, descriptor),
		() => loadMonitorMetrics(env, family, minutes),
		{
			family: descriptor.family,
			tier: spec.tier,
			params: descriptor.params,
			scope: "admin",
			source: "admin",
			validator: (value): value is MonitorMetrics => isMonitorCacheData(descriptor, value),
		},
	);
}

export function footprintFamilyName(family: string): string {
	return `${FOOTPRINT_PREFIX}${family}`;
}

export function parseMonitorMetricsQuery(params: {
	family?: string | null;
	minutes?: string | number | null;
}): { family: string | null; minutes: number } {
	const raw =
		typeof params.minutes === "number"
			? params.minutes
			: Number.parseInt(String(params.minutes ?? "1440"), 10);
	const minutes = Math.min(
		METRICS_MINUTES_MAX,
		Math.max(METRICS_MINUTES_MIN, Number.isFinite(raw) ? raw : 1440),
	);
	const family =
		typeof params.family === "string" && params.family.length > 0 ? params.family : null;
	return { family, minutes };
}
