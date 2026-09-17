import { CACHE_SCHEMA_VERSION, CACHE_TTL_SECONDS } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMetricsForTest } from "../../../../src/lib/cache/metrics";
import {
	acceptsCacheValue,
	bypassesCache,
	type CacheGetOrSetOptions,
	cacheRead,
	cacheReadMany,
	cacheWrite,
	createCacheEnvelope,
	isCacheEnvelope,
	metricFamily,
	putCacheEnvelope,
	validateCacheOptions,
} from "../../../../src/lib/cache/store";
import { createMockCtx, makeEnv } from "../../../helpers";

const BASE_NOW = 1_700_000_000_000;
const threadStatsOpts: CacheGetOrSetOptions<{ id: number }> = {
	family: "thread:stats",
	tier: "SHORT",
	scope: "public",
	params: { id: 1 },
};

function makeStoreKV() {
	const store = new Map<string, string>();
	const metadataStore = new Map<string, unknown>();
	const putOptionsStore = new Map<string, KVNamespacePutOptions | undefined>();

	const read = (key: string, type?: string) => {
		const raw = store.get(key) ?? null;
		return raw !== null && type === "json" ? JSON.parse(raw) : raw;
	};

	const kv = {
		get: vi.fn(async (key: string | string[], type?: string) => {
			if (Array.isArray(key)) {
				return new Map(key.map((k) => [k, read(k, type)]));
			}
			return read(key, type);
		}),
		put: vi.fn(async (key: string, value: string, opts?: KVNamespacePutOptions) => {
			store.set(key, value);
			putOptionsStore.set(key, opts);
			if (opts?.metadata) metadataStore.set(key, opts.metadata);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
			metadataStore.delete(key);
			putOptionsStore.delete(key);
		}),
	} as unknown as KVNamespace;

	return {
		kv,
		store,
		metadataStore,
		putOptionsStore,
		env: makeEnv({ KV: kv }),
		ctx: createMockCtx(),
	};
}

describe("lib/cache/store — core cache storage contract", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE_NOW);
		__resetMetricsForTest();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("metricFamily & bypassesCache", () => {
		it("differentiates admin vs business metric family", () => {
			expect(metricFamily({ family: "thread:stats", tier: "SHORT" })).toBe("thread:stats");
			expect(metricFamily({ family: "thread:stats", tier: "SHORT", source: "admin" })).toBe(
				"admin:thread:stats",
			);
			expect(metricFamily({ family: "thread:stats", tier: "SHORT", source: "business" })).toBe(
				"thread:stats",
			);
		});

		it("checks bypassesCache via !unavailable in key and CACHE_DISABLED_FAMILIES env", () => {
			const { env } = makeStoreKV();
			expect(bypassesCache(env, "thread:stats:1:!unavailable", "thread:stats")).toBe(true);
			expect(bypassesCache(env, "thread:stats:1", "thread:stats")).toBe(false);

			const disabledEnv = makeEnv({ CACHE_DISABLED_FAMILIES: "thread:stats,forum:tree:v2" });
			expect(bypassesCache(disabledEnv, "thread:stats:1", "thread:stats")).toBe(true);
			expect(bypassesCache(disabledEnv, "forum:tree:v2:key", "forum:tree:v2")).toBe(true);
			expect(bypassesCache(disabledEnv, "settings:all", "settings:all")).toBe(false);
		});
	});

	describe("validateCacheOptions", () => {
		it("validates registered family, tier matching, valid params and string scope", () => {
			expect(() => validateCacheOptions(threadStatsOpts)).not.toThrow();

			// Unknown family
			expect(() =>
				validateCacheOptions({
					family: "nonexistent:family",
					tier: "SHORT",
				}),
			).toThrow("A registered cache family and serializable parameters are required");

			// Tier mismatch (thread:stats is SHORT in registry, passing LONG fails)
			expect(() =>
				validateCacheOptions({
					family: "thread:stats",
					tier: "LONG",
				}),
			).toThrow("A registered cache family and serializable parameters are required");

			// Invalid params (non-primitive values)
			expect(() =>
				validateCacheOptions({
					family: "thread:stats",
					tier: "SHORT",
					params: { obj: { nested: true } as unknown as string },
				}),
			).toThrow("A registered cache family and serializable parameters are required");

			// Invalid scope (non-string)
			expect(() =>
				validateCacheOptions({
					family: "thread:stats",
					tier: "SHORT",
					scope: 123 as unknown as string,
				}),
			).toThrow("A registered cache family and serializable parameters are required");

			// Non-finite expiresAt
			expect(() =>
				validateCacheOptions({
					...threadStatsOpts,
					expiresAt: Number.NaN,
				}),
			).toThrow(RangeError);
		});
	});

	describe("createCacheEnvelope & isNegative downgrade to SHORT", () => {
		it("creates envelope with correct logical timestamps and schema version", () => {
			const envelope = createCacheEnvelope({ id: 1 }, threadStatsOpts);
			expect(envelope.schemaVersion).toBe(CACHE_SCHEMA_VERSION);
			expect(envelope.family).toBe("thread:stats");
			expect(envelope.tier).toBe("SHORT");
			expect(envelope.loadedAt).toBe(BASE_NOW);
			expect(envelope.expiresAt).toBe(BASE_NOW + CACHE_TTL_SECONDS.SHORT * 1000);
			expect(envelope.data).toEqual({ id: 1 });
		});

		it("caps expiresAt by options.expiresAt if earlier than tier TTL", () => {
			const earlyExpiry = BASE_NOW + 15_000; // 15 seconds < 60 seconds
			const envelope = createCacheEnvelope(
				{ id: 1 },
				{ ...threadStatsOpts, expiresAt: earlyExpiry },
			);
			expect(envelope.expiresAt).toBe(earlyExpiry);
		});

		it("downgrades negative results (null, empty arrays, empty items/types/forums) to SHORT tier even on LONG/MEDIUM family", () => {
			const longOpts: CacheGetOrSetOptions<unknown> = {
				family: "thread-types",
				tier: "LONG",
				scope: "internal",
				params: { forumId: 1 },
			};

			// Null result
			const nullEnv = createCacheEnvelope(null, longOpts);
			expect(nullEnv.tier).toBe("SHORT");
			expect(nullEnv.expiresAt).toBe(BASE_NOW + CACHE_TTL_SECONDS.SHORT * 1000);

			// Empty array
			const emptyArrEnv = createCacheEnvelope([], longOpts);
			expect(emptyArrEnv.tier).toBe("SHORT");

			// Empty object
			const emptyObjEnv = createCacheEnvelope({}, longOpts);
			expect(emptyObjEnv.tier).toBe("SHORT");

			// Empty items
			const emptyItemsEnv = createCacheEnvelope({ items: [] }, longOpts);
			expect(emptyItemsEnv.tier).toBe("SHORT");

			// Empty types
			const emptyTypesEnv = createCacheEnvelope({ types: [] }, longOpts);
			expect(emptyTypesEnv.tier).toBe("SHORT");

			// Empty forums
			const emptyForumsEnv = createCacheEnvelope({ forums: [] }, longOpts);
			expect(emptyForumsEnv.tier).toBe("SHORT");
		});

		it("throws when loader returns undefined or fails validator", () => {
			expect(() => createCacheEnvelope(undefined, threadStatsOpts)).toThrow(TypeError);

			expect(() =>
				createCacheEnvelope(
					{ id: "not-a-number" as unknown as number },
					{
						...threadStatsOpts,
						validator: (v: unknown): v is { id: number } =>
							typeof (v as { id: number })?.id === "number",
					},
				),
			).toThrow(TypeError);
		});
	});

	describe("isCacheEnvelope & acceptsCacheValue", () => {
		it("rejects non-envelopes, invalid schemaVersion, and impossible timestamps", () => {
			expect(isCacheEnvelope(null)).toBe(false);
			expect(isCacheEnvelope(123)).toBe(false);
			expect(isCacheEnvelope("string")).toBe(false);

			const valid = createCacheEnvelope({ id: 1 }, threadStatsOpts);
			expect(isCacheEnvelope(valid)).toBe(true);

			// Wrong schemaVersion
			expect(isCacheEnvelope({ ...valid, schemaVersion: 999 })).toBe(false);

			// loadedAt < 0 or non-finite
			expect(isCacheEnvelope({ ...valid, loadedAt: -1 })).toBe(false);
			expect(isCacheEnvelope({ ...valid, loadedAt: Number.NaN })).toBe(false);

			// expiresAt <= loadedAt
			expect(isCacheEnvelope({ ...valid, expiresAt: valid.loadedAt })).toBe(false);
			expect(isCacheEnvelope({ ...valid, expiresAt: valid.loadedAt - 1000 })).toBe(false);

			// Expiry exceeding maximum TTL for tier
			expect(
				isCacheEnvelope({
					...valid,
					expiresAt: valid.loadedAt + (CACHE_TTL_SECONDS.SHORT + 10) * 1000,
				}),
			).toBe(false);
		});

		it("acceptsCacheValue verifies expiry against current wall time without extending TTL", () => {
			const envelope = createCacheEnvelope({ id: 1 }, threadStatsOpts);
			expect(acceptsCacheValue(envelope, threadStatsOpts)).toBe(true);

			// 1ms before expiry
			vi.setSystemTime(envelope.expiresAt - 1);
			expect(acceptsCacheValue(envelope, threadStatsOpts)).toBe(true);

			// At expiry boundary
			vi.setSystemTime(envelope.expiresAt);
			expect(acceptsCacheValue(envelope, threadStatsOpts)).toBe(false);

			// After expiry
			vi.setSystemTime(envelope.expiresAt + 1000);
			expect(acceptsCacheValue(envelope, threadStatsOpts)).toBe(false);

			// Future loadedAt (clock skew)
			vi.setSystemTime(BASE_NOW - 1000);
			expect(acceptsCacheValue(envelope, threadStatsOpts)).toBe(false);
		});

		it("acceptsCacheValue rejects mismatched family, scope, params, tier, or validator", () => {
			const envelope = createCacheEnvelope({ id: 1 }, threadStatsOpts);

			// Family mismatch
			expect(
				acceptsCacheValue(envelope, {
					...threadStatsOpts,
					family: "thread:entity" as unknown as string,
				}),
			).toBe(false);

			// Scope mismatch
			expect(acceptsCacheValue(envelope, { ...threadStatsOpts, scope: "admin" })).toBe(false);

			// Param mismatch (different value or different key)
			expect(acceptsCacheValue(envelope, { ...threadStatsOpts, params: { id: 2 } })).toBe(false);
			expect(acceptsCacheValue(envelope, { ...threadStatsOpts, params: { other: 1 } })).toBe(false);
			expect(acceptsCacheValue(envelope, { ...threadStatsOpts, params: { id: 1, extra: 2 } })).toBe(
				false,
			);

			// Validator failure
			expect(acceptsCacheValue(envelope, { ...threadStatsOpts, validator: () => false })).toBe(
				false,
			);
		});
	});

	describe("putCacheEnvelope & metadata tracking", () => {
		it("writes serialized envelope and precise metadata without changing logical timestamps", async () => {
			const { env, kv, store, metadataStore, putOptionsStore } = makeStoreKV();
			const envelope = createCacheEnvelope({ id: 1 }, threadStatsOpts);

			await putCacheEnvelope(env, "k1", envelope);

			expect(kv.put).toHaveBeenCalledTimes(1);
			expect(store.has("k1")).toBe(true);

			// Verification of expirationTtl passed to KV
			const putOpts = putOptionsStore.get("k1");
			expect(putOpts?.expirationTtl).toBe(CACHE_TTL_SECONDS.SHORT);

			// Verification of metadata
			const meta = metadataStore.get("k1") as Record<string, unknown>;
			expect(meta).toMatchObject({
				schemaVersion: CACHE_SCHEMA_VERSION,
				family: "thread:stats",
				loadedAt: BASE_NOW,
				expiresAt: BASE_NOW + CACHE_TTL_SECONDS.SHORT * 1000,
				tier: "SHORT",
			});
			expect(meta.sizeBytes).toBeGreaterThan(0);
			expect(meta.contentUtf8Bytes).toBe(meta.sizeBytes);
		});

		it("rejects expired envelope or invalid envelope before writing", async () => {
			const { env, kv } = makeStoreKV();
			const envelope = createCacheEnvelope({ id: 1 }, threadStatsOpts);

			// Time travels past expiry
			vi.setSystemTime(envelope.expiresAt + 1);

			await expect(putCacheEnvelope(env, "k1", envelope)).rejects.toThrow(RangeError);
			expect(kv.put).not.toHaveBeenCalled();

			// Malformed envelope
			await expect(
				putCacheEnvelope(env, "k1", { bogus: true } as unknown as typeof envelope),
			).rejects.toThrow(RangeError);
		});

		it("throws RangeError if serialized value exceeds MAX_VALUE_BYTES (2MB)", async () => {
			const { env } = makeStoreKV();
			// Large string ~2.1MB
			const bigString = "x".repeat(2.1 * 1024 * 1024);
			const envelope = createCacheEnvelope(
				{ big: bigString },
				{
					family: "thread:stats",
					tier: "SHORT",
				},
			);

			await expect(putCacheEnvelope(env, "k_big", envelope)).rejects.toThrow(
				"Cache value exceeds the admission limit",
			);
		});
	});

	describe("cacheRead & cacheWrite operations", () => {
		it("cacheRead returns data on hit and null on miss or expired value", async () => {
			const { env } = makeStoreKV();
			const key = "k_read";

			// Miss
			const miss = await cacheRead(env, key, threadStatsOpts);
			expect(miss).toBeNull();

			// Write
			const written = await cacheWrite(env, undefined, key, { id: 42 }, threadStatsOpts);
			expect(written).toBe(true);

			// Hit
			const hit = await cacheRead(env, key, threadStatsOpts);
			expect(hit).toEqual({ id: 42 });

			// Expired hit returns null
			vi.setSystemTime(BASE_NOW + 61_000);
			const expired = await cacheRead(env, key, threadStatsOpts);
			expect(expired).toBeNull();
		});

		it("cacheWrite bypasses when family is disabled and handles KV write errors gracefully", async () => {
			const disabledEnv = makeEnv({ CACHE_DISABLED_FAMILIES: "thread:stats" });
			const success = await cacheWrite(
				disabledEnv,
				undefined,
				"k_disabled",
				{ id: 1 },
				threadStatsOpts,
			);
			expect(success).toBe(false);

			// KV write throws error
			const failingKV = {
				put: vi.fn(async () => {
					throw new Error("KV 500 internal error");
				}),
				get: vi.fn(async () => null),
			} as unknown as KVNamespace;
			const errEnv = makeEnv({ KV: failingKV });

			const writeResult = await cacheWrite(errEnv, undefined, "k_fail", { id: 1 }, threadStatsOpts);
			expect(writeResult).toBe(false);
		});
	});

	describe("cacheReadMany bulk operations & chunking", () => {
		it("chunks bulk reads into batches of 100 keys and aggregates hits", async () => {
			const { env, store } = makeStoreKV();

			// Populate 120 keys
			const keys: string[] = [];
			for (let i = 1; i <= 120; i++) {
				const k = `key_${i}`;
				keys.push(k);
				const envRow = createCacheEnvelope({ id: i }, { ...threadStatsOpts, params: { id: i } });
				store.set(k, JSON.stringify(envRow));
			}

			const results = await cacheReadMany(env, keys, (k) => {
				const id = Number.parseInt(k.replace("key_", ""), 10);
				return { ...threadStatsOpts, params: { id } };
			});

			expect(results.size).toBe(120);
			expect(results.get("key_1")).toEqual({ id: 1 });
			expect(results.get("key_120")).toEqual({ id: 120 });
		});

		it("handles invalid bulk response (not a Map) without crashing and records errors", async () => {
			const badKV = {
				get: vi.fn(async () => ({ invalid: "not a Map" })),
			} as unknown as KVNamespace;
			const errEnv = makeEnv({ KV: badKV });

			const results = await cacheReadMany(errEnv, ["k1", "k2"], threadStatsOpts);
			expect(results.size).toBe(0);
		});
	});
});
