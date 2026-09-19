import {
	CACHE_SCHEMA_VERSION,
	type CacheEnvelope,
	type CacheParams,
	type CacheTier,
	getCacheTTL,
} from "@ellie/types";
import type { Env } from "../env";
import { findFamily } from "./kv-registry";
import {
	recordError,
	recordHit,
	recordKvOp,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
} from "./metrics";

export interface CacheGetOrSetOptions<T> {
	family: string;
	tier: CacheTier;
	validator?: (value: unknown) => value is T;
	params?: CacheParams;
	scope?: string;
	/** A composed snapshot cannot outlive its earliest dependency. */
	expiresAt?: number;
	source?: "business" | "admin";
}

const MAX_VALUE_BYTES = 2 * 1024 * 1024;

export function metricFamily(options: CacheGetOrSetOptions<unknown>): string {
	return options.source === "admin" ? `admin:${options.family}` : options.family;
}

export function bypassesCache(env: Env, key: string, family: string): boolean {
	return (
		key.includes("!unavailable") ||
		(env.CACHE_DISABLED_FAMILIES ?? "").split(",").some((value) => value.trim() === family)
	);
}

function validParams(value: unknown): value is CacheParams {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(
			(item) =>
				item === null ||
				typeof item === "string" ||
				typeof item === "boolean" ||
				(typeof item === "number" && Number.isFinite(item)),
		)
	);
}

/** Structural validation is separate from expiry so Admin can diagnose old values. */
export function isCacheEnvelope(value: unknown): value is CacheEnvelope {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Partial<CacheEnvelope>;
	if (
		entry.schemaVersion !== CACHE_SCHEMA_VERSION ||
		typeof entry.family !== "string" ||
		typeof entry.scope !== "string" ||
		!validParams(entry.params) ||
		!Object.hasOwn(entry, "data") ||
		typeof entry.loadedAt !== "number" ||
		typeof entry.expiresAt !== "number" ||
		!Number.isFinite(entry.loadedAt) ||
		!Number.isFinite(entry.expiresAt) ||
		entry.loadedAt < 0 ||
		entry.expiresAt <= entry.loadedAt
	) {
		return false;
	}
	if (
		entry.tier !== "SHORT" &&
		entry.tier !== "MEDIUM" &&
		entry.tier !== "HOUR" &&
		entry.tier !== "LONG"
	)
		return false;
	return entry.expiresAt <= entry.loadedAt + getCacheTTL(entry.tier) * 1000;
}

function isNegative(value: unknown): boolean {
	if (value === null || (Array.isArray(value) && value.length === 0)) return true;
	if (typeof value !== "object" || value === null) return false;
	if (Object.keys(value).length === 0) return true;
	return ["items", "types", "forums"].some((field) => {
		const rows = (value as Record<string, unknown>)[field];
		return Array.isArray(rows) && rows.length === 0;
	});
}

export function acceptsCacheValue<T>(
	value: unknown,
	options: CacheGetOrSetOptions<T>,
): value is CacheEnvelope<T> {
	return (
		isCacheEnvelope(value) &&
		value.family === options.family &&
		value.scope === (options.scope ?? "public") &&
		Object.keys(value.params).length === Object.keys(options.params ?? {}).length &&
		Object.entries(value.params).every(([key, param]) => options.params?.[key] === param) &&
		value.expiresAt > Date.now() &&
		value.loadedAt <= Date.now() &&
		(value.tier === options.tier || (value.tier === "SHORT" && isNegative(value.data))) &&
		(!options.validator || options.validator(value.data))
	);
}

export function validateCacheOptions<T>(options: CacheGetOrSetOptions<T>): void {
	getCacheTTL(options.tier);
	const spec = findFamily(options.family);
	if (
		!spec?.tier ||
		spec.status !== "shipped" ||
		spec.tier !== options.tier ||
		!validParams(options.params ?? {}) ||
		typeof (options.scope ?? "public") !== "string"
	) {
		throw new TypeError("A registered cache family and serializable parameters are required");
	}
	if (options.expiresAt !== undefined && !Number.isFinite(options.expiresAt)) {
		throw new RangeError("Cache dependency expiry must be finite");
	}
}

export function createCacheEnvelope<T>(
	data: T,
	options: CacheGetOrSetOptions<T>,
): CacheEnvelope<T> {
	validateCacheOptions(options);
	if (data === undefined || (options.validator && !options.validator(data))) {
		throw new TypeError("Cache loader returned an invalid value");
	}
	// Empty optional post data is a valid snapshot, not a missing resource.
	const keepEmpty =
		Array.isArray(data) &&
		["post:attachments", "post:comments", "post:rating-rows"].includes(options.family);
	const tier = isNegative(data) && !keepEmpty ? "SHORT" : options.tier;
	const loadedAt = Date.now();
	return {
		schemaVersion: CACHE_SCHEMA_VERSION,
		family: options.family,
		tier,
		loadedAt,
		expiresAt: Math.min(loadedAt + getCacheTTL(tier) * 1000, options.expiresAt ?? Infinity),
		params: options.params ?? {},
		scope: options.scope ?? "public",
		data,
	};
}

/** Strict write for management: never reset the envelope's logical timestamps. */
export async function putCacheEnvelope(
	env: Env,
	key: string,
	entry: CacheEnvelope,
	source: "business" | "admin" = "business",
): Promise<void> {
	if (!isCacheEnvelope(entry) || entry.expiresAt <= Date.now()) {
		throw new RangeError("Cannot fill an expired or invalid cache snapshot");
	}
	const spec = findFamily(entry.family);
	if (
		!spec?.tier ||
		spec.status !== "shipped" ||
		(entry.tier !== spec.tier && !(entry.tier === "SHORT" && isNegative(entry.data)))
	) {
		throw new TypeError("Snapshot tier does not match its registered family");
	}
	const serialized = JSON.stringify(entry);
	const sizeBytes = new TextEncoder().encode(serialized).byteLength;
	if (sizeBytes > MAX_VALUE_BYTES) throw new RangeError("Cache value exceeds the admission limit");
	recordKvOp(metricFamily({ ...entry, source }), "kv-put");
	await env.KV.put(key, serialized, {
		expirationTtl: getCacheTTL(entry.tier),
		metadata: {
			schemaVersion: entry.schemaVersion,
			family: entry.family,
			loadedAt: entry.loadedAt,
			expiresAt: entry.expiresAt,
			sizeBytes,
			contentUtf8Bytes: sizeBytes,
			tier: entry.tier,
		},
	});
	recordWrite(metricFamily({ ...entry, source }));
}

/** Read only; old raw payloads and expired envelopes are cache misses. */
export async function cacheRead<T>(
	env: Env,
	key: string,
	options: CacheGetOrSetOptions<T>,
): Promise<T | null> {
	validateCacheOptions(options);
	const family = metricFamily(options);
	recordRead(family);
	try {
		if (!bypassesCache(env, key, options.family)) recordKvOp(family, "kv-get");
		const raw = bypassesCache(env, key, options.family) ? null : await env.KV.get(key, "json");
		if (acceptsCacheValue(raw, options)) {
			recordHit(family);
			return raw.data;
		}
	} catch {
		recordError(family);
	}
	recordMiss(family);
	return null;
}

/** Bounded KV bulk reads; callers batch only the missing D1 entities afterwards. */
export async function cacheReadMany<T>(
	env: Env,
	keys: string[],
	options: CacheGetOrSetOptions<T> | ((key: string) => CacheGetOrSetOptions<T>),
): Promise<Map<string, T>> {
	const result = new Map<string, T>();
	const resolve = typeof options === "function" ? options : () => options;
	const unique = [...new Set(keys)];
	for (let offset = 0; offset < unique.length; offset += 100) {
		const batch = unique.slice(offset, offset + 100).map((key) => ({ key, setting: resolve(key) }));
		for (const { setting } of batch) validateCacheOptions(setting);
		const readable = batch.filter(({ key, setting }) => !bypassesCache(env, key, setting.family));
		let values = new Map<string, unknown>();
		try {
			for (const { setting } of readable) recordKvOp(metricFamily(setting), "kv-get");
			if (readable.length) {
				const loaded = await env.KV.get(
					readable.map(({ key }) => key),
					"json",
				);
				if (!(loaded instanceof Map)) throw new TypeError("Invalid KV bulk response");
				values = loaded;
			}
		} catch {
			for (const { setting } of readable) recordError(metricFamily(setting));
		}
		for (const { key, setting } of batch) {
			const family = metricFamily(setting);
			recordRead(family);
			const value = values.get(key);
			if (acceptsCacheValue(value, setting)) {
				recordHit(family);
				result.set(key, value.data);
			} else {
				recordMiss(family);
			}
		}
	}
	return result;
}

export async function cacheWrite<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	key: string,
	data: T,
	options: CacheGetOrSetOptions<T>,
): Promise<boolean> {
	validateCacheOptions(options);
	if (bypassesCache(env, key, options.family)) return false;
	try {
		await putCacheEnvelope(env, key, createCacheEnvelope(data, options), options.source);
		return true;
	} catch {
		recordError(metricFamily(options));
		recordKvOp(metricFamily(options), "write-error");
		return false;
	} finally {
		if (ctx) scheduleMetricsFlush(env, ctx);
	}
}
