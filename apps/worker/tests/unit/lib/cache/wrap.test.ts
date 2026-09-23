import { CACHE_TTL_SECONDS, type CacheTier } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CacheLoadLimitError,
	cacheDelete,
	cacheGetOrSet,
	cacheRead,
	cacheReadMany,
	cacheWrite,
	createCacheEnvelope,
	isCacheEnvelope,
	putCacheEnvelope,
} from "../../../../src/lib/cache/wrap";
import { createMockCtx, makeEnv } from "../../../helpers";

const options = {
	family: "user:stats",
	tier: "SHORT" as const,
	scope: "public",
	params: { id: 1 },
};
const now = 1_000_000;
async function drain(ctx: ExecutionContext) {
	await Promise.all(vi.mocked(ctx.waitUntil).mock.calls.map(([work]) => work));
}

function jsonKV() {
	const store = new Map<string, string>();
	const read = (key: string, type?: string) => {
		const raw = store.get(key) ?? null;
		return raw !== null && type === "json" ? JSON.parse(raw) : raw;
	};
	const kv = {
		get: vi.fn(async (key: string | string[], type?: string) =>
			Array.isArray(key) ? new Map(key.map((k) => [k, read(k, type)])) : read(key, type),
		),
		put: vi.fn(async (key: string, value: string, _opts?: KVNamespacePutOptions) => {
			store.set(key, value);
		}),
		delete: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as KVNamespace;
	return { kv, store, env: makeEnv({ KV: kv }), ctx: createMockCtx() };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(now);
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("unified cache time and origin contract", () => {
	it.each(Object.entries(CACHE_TTL_SECONDS))(
		"%s uses exactly its tier and expires at the boundary",
		async (tier, seconds) => {
			const { env, ctx, kv, store } = jsonKV();
			const settings = {
				...options,
				family: {
					SHORT: "user:stats",
					MEDIUM: "thread:entity",
					HOUR: "user:search",
					LONG: "post:attachments",
				}[tier as CacheTier],
				tier: tier as CacheTier,
			};
			const load = vi.fn(async () => ({ id: 7 }));
			expect(await cacheGetOrSet(env, ctx, "k", load, settings)).toEqual({ id: 7 });
			await drain(ctx);
			const initial = store.get("k");
			const parsed = JSON.parse(initial ?? expect.fail("Missing cache snapshot"));
			expect(parsed).toMatchObject({ loadedAt: now, expiresAt: now + seconds * 1000, tier });
			expect(kv.put).toHaveBeenCalledWith(
				"k",
				initial,
				expect.objectContaining({ expirationTtl: seconds }),
			);
			vi.setSystemTime(now + seconds * 1000 - 1);
			await cacheGetOrSet(env, ctx, "k", load, settings);
			expect(load).toHaveBeenCalledTimes(1);
			expect(store.get("k")).toBe(initial);
			await drain(ctx);
			vi.setSystemTime(now + seconds * 1000);
			await cacheGetOrSet(env, ctx, "k", load, settings);
			expect(load).toHaveBeenCalledTimes(2);
		},
	);
	it("rejects arbitrary seconds, old 30-second options and invalid tiers before any I/O", async () => {
		const { env, ctx, kv } = jsonKV();
		const load = vi.fn(async () => 1);
		for (const settings of [
			{ ...options, tier: "FIVE_MINUTES" },
			{ family: options.family, ttl: 30 },
			{ ...options, family: "" },
		]) {
			await expect(
				cacheGetOrSet(env, ctx, "k", load, settings as typeof options),
			).rejects.toThrow();
		}
		expect(kv.get).not.toHaveBeenCalled();
		expect(load).not.toHaveBeenCalled();
	});
	it("old unwrapped data, malformed data, future timestamps and schema drift cannot hit", async () => {
		const { env, ctx, store } = jsonKV();
		const load = vi.fn(async () => 7);
		for (const value of [
			5,
			"{",
			JSON.stringify({ ...createCacheEnvelope(3, options), schemaVersion: 2 }),
			JSON.stringify({ ...createCacheEnvelope(3, options), loadedAt: now + 1 }),
		]) {
			store.set("k", typeof value === "string" ? value : JSON.stringify(value));
			expect(await cacheGetOrSet(env, ctx, "k", load, options)).toBe(7);
			await drain(ctx);
		}
		expect(load).toHaveBeenCalledTimes(4);
	});
	it.each([null, [], {}, { items: [], hasMore: false }, { forums: [] }])(
		"negative result %j uses SHORT and is reusable without renewal",
		async (value) => {
			const { env, ctx, store } = jsonKV();
			const load = vi.fn(async () => value);
			const settings = { ...options, family: "recommended:threads", tier: "LONG" as const };
			await cacheGetOrSet(env, ctx, "k", load, settings);
			await cacheGetOrSet(env, ctx, "k", load, settings);
			expect(load).toHaveBeenCalledTimes(1);
			expect(JSON.parse(store.get("k") ?? expect.fail("Missing cache snapshot"))).toMatchObject({
				tier: "SHORT",
				expiresAt: now + 60_000,
			});
		},
	);
	it("retains the earliest source deadline across composition and delayed fill", async () => {
		const { env, kv } = jsonKV();
		const entry = createCacheEnvelope("snapshot", {
			...options,
			family: "post:attachments",
			tier: "LONG",
			expiresAt: now + 30_000,
		});
		vi.setSystemTime(now + 20_000);
		await putCacheEnvelope(env, "k", entry);
		expect(kv.put).toHaveBeenCalledWith(
			"k",
			JSON.stringify(entry),
			expect.objectContaining({ expirationTtl: 86400 }),
		);
		vi.setSystemTime(now + 30_000);
		await expect(putCacheEnvelope(env, "k", entry)).rejects.toThrow(/expired/);
		expect(
			await cacheRead(env, "k", { ...options, family: "post:attachments", tier: "LONG" }),
		).toBeNull();
	});
	it("100 concurrent cold reads share one loader through a slow writeback", async () => {
		const { env, ctx, kv } = jsonKV();
		let finishWrite!: () => void;
		vi.mocked(kv.put).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishWrite = resolve;
				}),
		);
		const load = vi.fn(async () => ({ id: 1 }));
		const requests = Array.from({ length: 100 }, () => cacheGetOrSet(env, ctx, "k", load, options));
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(load).toHaveBeenCalledTimes(1);
		requests.push(cacheGetOrSet(env, ctx, "k", load, options));
		finishWrite();
		const values = await Promise.all(requests);
		expect(values).toHaveLength(101);
		expect(kv.put).toHaveBeenCalledTimes(1);
		values[0].id = 99;
		expect(values[1].id).toBe(1);
	});
	it("returns before a slow fill, coalesces readers, and fences deletion until the fill settles", async () => {
		const { env, ctx, kv, store } = jsonKV();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(kv.put).mockImplementation(async (key, value) => {
			await gate;
			store.set(key, value as string);
		});
		const load = vi.fn(async () => ({ id: 1 }));
		expect(await cacheGetOrSet(env, ctx, "k", load, options)).toEqual({ id: 1 });
		expect(store.has("k")).toBe(false);
		expect(await cacheGetOrSet(env, ctx, "k", load, options)).toEqual({ id: 1 });
		expect(load).toHaveBeenCalledTimes(1);
		const deletion = cacheDelete(env, "k", options.family);
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(kv.delete).not.toHaveBeenCalled();
		release();
		expect(await deletion).toBe(true);
		expect(store.has("k")).toBe(false);
	});

	it("keeps a stalled background fill fenced after its timeout", async () => {
		const { env, ctx, kv } = jsonKV();
		let release!: () => void;
		vi.mocked(kv.put).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		expect(await cacheGetOrSet(env, ctx, "k", async () => 1, options)).toBe(1);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(await cacheDelete(env, "k", options.family)).toBe(false);
		expect(kv.delete).not.toHaveBeenCalled();
		release();
		await Promise.all(vi.mocked(ctx.waitUntil).mock.calls.map(([work]) => work));
		expect(await cacheDelete(env, "k", options.family)).toBe(true);
	});

	it("bounds waiters behind fills and rechecks KV after waiting on a known miss", async () => {
		const { env, ctx, kv, store } = jsonKV();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(kv.put).mockImplementation(async (key, value) => {
			await gate;
			store.set(key, value as string);
		});
		await Promise.all(
			Array.from({ length: 256 }, (_, id) =>
				cacheGetOrSet(env, ctx, `fill-${id}`, async () => id, options),
			),
		);
		const origin = vi.fn(async () => -1);
		const waiting = Array.from({ length: 256 }, (_, id) =>
			cacheGetOrSet(env, ctx, `next-${id}`, origin, { ...options, knownMiss: true }),
		);
		await expect(cacheGetOrSet(env, ctx, "overflow", origin, options)).rejects.toBeInstanceOf(
			CacheLoadLimitError,
		);
		expect(origin).not.toHaveBeenCalled();
		// Another request may populate the previously missing key while we wait.
		for (let id = 0; id < 256; id++)
			store.set(`next-${id}`, JSON.stringify(createCacheEnvelope(id, options)));
		release();
		expect(await Promise.all(waiting)).toEqual(Array.from({ length: 256 }, (_, id) => id));
		expect(origin).not.toHaveBeenCalled();
		await drain(ctx);
	});

	it("a mutation during admission waiting still fences the subsequent fill", async () => {
		const { env, ctx, kv, store } = jsonKV();
		let releaseFills!: () => void;
		const gate = new Promise<void>((resolve) => {
			releaseFills = resolve;
		});
		vi.mocked(kv.put).mockImplementation(async (key, value) => {
			await gate;
			store.set(key, value as string);
		});
		await Promise.all(
			Array.from({ length: 256 }, (_, id) =>
				cacheGetOrSet(env, ctx, `fill-${id}`, async () => id, options),
			),
		);
		const queued = cacheGetOrSet(env, ctx, "mutated", async () => "current", {
			...options,
			knownMiss: true,
		});
		let releaseDelete!: () => void;
		const deletionGate = new Promise<void>((resolve) => {
			releaseDelete = resolve;
		});
		vi.mocked(kv.delete).mockImplementation(async (key) => {
			await deletionGate;
			store.delete(key);
		});
		const deletion = cacheDelete(env, "mutated", options.family);
		releaseFills();
		expect(await queued).toBe("current");
		await drain(ctx);
		expect(store.has("mutated")).toBe(false);
		releaseDelete();
		expect(await deletion).toBe(true);
	});

	it("times out admission waiters without freeing stalled fill permits", async () => {
		const { env, ctx, kv } = jsonKV();
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.mocked(kv.put).mockImplementation(() => gate);
		await Promise.all(
			Array.from({ length: 256 }, (_, id) =>
				cacheGetOrSet(env, ctx, `fill-${id}`, async () => id, options),
			),
		);
		const origin = vi.fn(async () => 1);
		const check = expect(
			cacheGetOrSet(env, ctx, "waiting", origin, options),
		).rejects.toBeInstanceOf(CacheLoadLimitError);
		await vi.advanceTimersByTimeAsync(20_000);
		await check;
		await expect(cacheGetOrSet(env, ctx, "still-full", origin, options)).rejects.toBeInstanceOf(
			CacheLoadLimitError,
		);
		expect(origin).not.toHaveBeenCalled();
		release();
		await drain(ctx);
		expect(await cacheGetOrSet(env, ctx, "recovered", origin, options)).toBe(1);
		await drain(ctx);
	});

	it("different scopes and bindings never share loaders or expose cached values", async () => {
		const first = jsonKV();
		const second = jsonKV();
		const publicLoad = vi.fn(async () => "public");
		const privateLoad = vi.fn(async () => "private");
		await Promise.all([
			cacheGetOrSet(first.env, first.ctx, "k", publicLoad, options),
			cacheGetOrSet(second.env, second.ctx, "k", privateLoad, options),
		]);
		expect(privateLoad).toHaveBeenCalledTimes(1);
		expect(await cacheRead(first.env, "k", { ...options, scope: "user:1" })).toBeNull();
		expect(await cacheRead(first.env, "k", { ...options, family: "search:threads" })).toBeNull();
	});
	it("loader failure is shared, never cached as empty, and the next attempt can retry", async () => {
		const { env, ctx, kv } = jsonKV();
		const failure = new Error("D1 unavailable");
		const load = vi.fn(async () => {
			throw failure;
		});
		const results = await Promise.allSettled(
			Array.from({ length: 20 }, () => cacheGetOrSet(env, ctx, "k", load, options)),
		);
		expect(results.every((result) => result.status === "rejected")).toBe(true);
		expect(load).toHaveBeenCalledTimes(1);
		expect(kv.put).not.toHaveBeenCalled();
		expect(await cacheGetOrSet(env, ctx, "k", async () => 3, options)).toBe(3);
	});
	it("KV read/write outages preserve the authoritative result without first-hit D1 metric writes", async () => {
		const { env, ctx, kv } = jsonKV();
		env.DB = { prepare: vi.fn() } as unknown as D1Database;
		vi.mocked(kv.get).mockRejectedValue(new Error("429"));
		vi.mocked(kv.put).mockRejectedValue(new Error("429"));
		expect(await cacheGetOrSet(env, ctx, "k", async () => 42, options)).toBe(42);
		expect(env.DB.prepare).not.toHaveBeenCalled();
	});
	it("generation read failures and family rollback bypass KV without seeding", async () => {
		const { env, ctx, kv } = jsonKV();
		await cacheGetOrSet(env, ctx, "cache:!unavailable", async () => 1, options);
		env.CACHE_DISABLED_FAMILIES = options.family;
		await cacheGetOrSet(env, ctx, "k", async () => 2, options);
		expect(kv.get).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
	});
	it("bulk reads deduplicate and respect the 100-key boundary, then report misses", async () => {
		const { env, kv, store } = jsonKV();
		const keys = Array.from({ length: 201 }, (_, i) => `k${i}`);
		store.set("k0", JSON.stringify(createCacheEnvelope(7, options)));
		const found = await cacheReadMany<number>(env, [...keys, "k0"], () => options);
		expect(found).toEqual(new Map([["k0", 7]]));
		expect(vi.mocked(kv.get).mock.calls.map((call) => (call[0] as string[]).length)).toEqual([
			100, 100, 1,
		]);
		vi.mocked(kv.get).mockRejectedValue(new Error("unavailable"));
		expect(await cacheReadMany(env, ["x"], options)).toEqual(new Map());
		env.CACHE_DISABLED_FAMILIES = options.family;
		expect(await cacheReadMany(env, ["x"], options)).toEqual(new Map());
	});
	it("validator mismatch reloads; invalid loader values and oversized entries never fill", async () => {
		const { env, ctx, store } = jsonKV();
		const validator = (value: unknown): value is number => typeof value === "number";
		store.set("k", JSON.stringify(createCacheEnvelope("old", options)));
		expect(await cacheGetOrSet(env, ctx, "k", async () => 9, { ...options, validator })).toBe(9);
		expect(await cacheWrite(env, ctx, "invalid", undefined, options)).toBe(false);
		expect(await cacheWrite(env, ctx, "large", "x".repeat(2 * 1024 * 1024), options)).toBe(false);
		expect(
			await cacheWrite(env, ctx, "shape", "x", {
				...options,
				validator: ((value: unknown) => typeof value === "number") as (
					value: unknown,
				) => value is string,
			}),
		).toBe(false);
		expect(store.has("invalid")).toBe(false);
	});
	it("metadata has actual UTF-8 bytes and preview cannot write or renew", async () => {
		const { env, ctx, kv, store } = jsonKV();
		await cacheWrite(env, ctx, "k", { text: "缓存💾" }, options);
		const content = store.get("k") ?? expect.fail("Missing cache snapshot");
		expect(kv.put).toHaveBeenCalledWith(
			"k",
			content,
			expect.objectContaining({
				metadata: expect.objectContaining({
					contentUtf8Bytes: new TextEncoder().encode(content).length,
				}),
			}),
		);
		vi.mocked(kv.put).mockClear();
		expect(await cacheRead(env, "k", options)).toEqual({ text: "缓存💾" });
		expect(kv.put).not.toHaveBeenCalled();
	});
	it("delete fences pending fills and reports KV failure honestly", async () => {
		const { env, ctx, kv, store } = jsonKV();
		let complete!: (value: number) => void;
		const request = cacheGetOrSet(
			env,
			ctx,
			"k",
			() =>
				new Promise<number>((resolve) => {
					complete = resolve;
				}),
			options,
		);
		for (let i = 0; i < 4; i++) await Promise.resolve();
		const deletion = cacheDelete(env, "k", options.family);
		complete(4);
		await request;
		expect(await deletion).toBe(true);
		expect(store.has("k")).toBe(false);
		vi.mocked(kv.delete).mockRejectedValue(new Error("down"));
		expect(await cacheDelete(env, "k", options.family)).toBe(false);
	});
	it("origin timeout fences late fill and releases capacity only after origin settles", async () => {
		const { env, ctx, kv } = jsonKV();
		let finish!: (value: number) => void;
		const request = cacheGetOrSet(
			env,
			ctx,
			"k",
			() =>
				new Promise<number>((resolve) => {
					finish = resolve;
				}),
			options,
		);
		const check = expect(request).rejects.toBeInstanceOf(CacheLoadLimitError);
		await vi.advanceTimersByTimeAsync(20_000);
		await check;
		finish(1);
		await drain(ctx);
		expect(kv.put).not.toHaveBeenCalled();
		expect(await cacheGetOrSet(env, undefined, "k", async () => 2, options)).toBe(2);
	});

	it("envelope validation rejects invalid lifetimes and descriptors", () => {
		const entry = createCacheEnvelope(1, options);
		for (const invalid of [
			null,
			{},
			{ ...entry, tier: "OTHER" },
			{ ...entry, expiresAt: now },
			{ ...entry, expiresAt: Infinity },
			{ ...entry, expiresAt: now + 60_001 },
			{ ...entry, params: { id: NaN } },
		])
			expect(isCacheEnvelope(invalid)).toBe(false);
		expect(() => createCacheEnvelope(1, { ...options, expiresAt: NaN })).toThrow();
	});
	it("256 outstanding origins retain their permits after timeouts until the actual I/O settles", async () => {
		const { env, kv } = jsonKV();
		vi.mocked(kv.get).mockRejectedValue(new Error("KV unavailable"));
		const finish: ((value: number) => void)[] = [];
		const load = vi.fn(
			() =>
				new Promise<number>((resolve) => {
					finish.push(resolve);
				}),
		);
		const requests = Promise.allSettled(
			Array.from({ length: 256 }, (_, id) =>
				cacheGetOrSet(env, undefined, `cold-${id}`, load, options),
			),
		);
		for (let index = 0; index < 6; index++) await Promise.resolve();
		expect(load).toHaveBeenCalledTimes(256);
		await expect(cacheGetOrSet(env, undefined, "overflow", load, options)).rejects.toBeInstanceOf(
			CacheLoadLimitError,
		);
		await vi.advanceTimersByTimeAsync(20_000);
		expect((await requests).every((result) => result.status === "rejected")).toBe(true);
		await expect(
			cacheGetOrSet(env, undefined, "still-overflow", load, options),
		).rejects.toBeInstanceOf(CacheLoadLimitError);
		for (const resolve of finish) resolve(1);
		for (let index = 0; index < 8; index++) await Promise.resolve();
		expect(kv.put).not.toHaveBeenCalled();
		expect(await cacheGetOrSet(env, undefined, "recovered", async () => 2, options)).toBe(2);
	});
	it("sequential KV-failure requests cannot exceed 8192 origin admissions per 60 seconds", async () => {
		const { env, kv, store } = jsonKV();
		env.CACHE_DISABLED_FAMILIES = options.family;
		const load = vi.fn(async () => 1);
		for (let index = 0; index < 8192; index++)
			await cacheGetOrSet(env, undefined, "bypass", load, options);
		await expect(cacheGetOrSet(env, undefined, "bypass", load, options)).rejects.toBeInstanceOf(
			CacheLoadLimitError,
		);
		expect(load).toHaveBeenCalledTimes(8192);
		expect(kv.put).not.toHaveBeenCalled();
		// A valid hit does not consume an origin admission even while the origin is capped.
		env.CACHE_DISABLED_FAMILIES = "";
		store.set("hot", JSON.stringify(createCacheEnvelope(7, options)));
		expect(await cacheGetOrSet(env, undefined, "hot", load, options)).toBe(7);
		vi.setSystemTime(now + 60_000);
		expect(await cacheGetOrSet(env, undefined, "bypass", load, options)).toBe(1);
		expect(load).toHaveBeenCalledTimes(8193);
	});
	it("regional negative read caching may cause another load, but cannot renew the logical deadline", async () => {
		const authoritative = new Map<string, string>();
		const regional = () => {
			const reads = new Map<string, { raw: string | null; until: number }>();
			const kv = {
				get: vi.fn(async (key: string, type?: string) => {
					let cached = reads.get(key);
					if (!cached || cached.until <= Date.now()) {
						cached = { raw: authoritative.get(key) ?? null, until: Date.now() + 60_000 };
						reads.set(key, cached);
					}
					return type === "json" && cached.raw !== null ? JSON.parse(cached.raw) : cached.raw;
				}),
				put: vi.fn(async (key: string, raw: string) => {
					authoritative.set(key, raw);
				}),
			} as unknown as KVNamespace;
			return makeEnv({ KV: kv });
		};
		const west = regional();
		const east = regional();
		// East has observed absence before the West fill; it may retain that absence for 60s.
		await east.KV.get("k");
		const load = vi.fn(async () => ({ id: 1 }));
		await cacheGetOrSet(west, undefined, "k", load, options);
		await Promise.all(
			Array.from({ length: 100 }, () => cacheGetOrSet(east, undefined, "k", load, options)),
		);
		expect(load).toHaveBeenCalledTimes(2);
		const deadline = JSON.parse(
			authoritative.get("k") ?? expect.fail("Missing cache snapshot"),
		).expiresAt;
		vi.setSystemTime(deadline);
		// An old, physically present SHORT value is still rejected at its fixed deadline.
		await cacheGetOrSet(east, undefined, "k", load, options);
		expect(load).toHaveBeenCalledTimes(3);
		expect(
			JSON.parse(authoritative.get("k") ?? expect.fail("Missing cache snapshot")).loadedAt,
		).toBe(deadline);
	});
});
