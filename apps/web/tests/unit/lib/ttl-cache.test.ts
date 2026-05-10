import { describe, expect, it, vi } from "vitest";

import { createTtlCache } from "@/lib/ttl-cache";

describe("ttl-cache", () => {
	it("caches the result for the duration of TTL", async () => {
		let now = 1_000_000;
		const load = vi.fn(async () => "v1");
		const cache = createTtlCache<string>({ expirationMs: 1000, load, now: () => now });

		expect(await cache.get()).toBe("v1");
		expect(await cache.get()).toBe("v1");
		expect(load).toHaveBeenCalledTimes(1);

		now += 999;
		expect(await cache.get()).toBe("v1");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("reloads after expiry", async () => {
		let now = 0;
		let counter = 0;
		const load = vi.fn(async () => `v${++counter}`);
		const cache = createTtlCache<string>({ expirationMs: 1000, load, now: () => now });

		expect(await cache.get()).toBe("v1");
		now += 1500;
		expect(await cache.get()).toBe("v2");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("does not cache rejected loads", async () => {
		let attempts = 0;
		const load = vi.fn(async () => {
			attempts += 1;
			if (attempts === 1) throw new Error("boom");
			return "ok";
		});
		const cache = createTtlCache<string>({ expirationMs: 1000, load });

		await expect(cache.get()).rejects.toThrow("boom");
		expect(await cache.get()).toBe("ok");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("dedupes concurrent in-flight loads", async () => {
		let resolve!: (v: string) => void;
		const promise = new Promise<string>((r) => {
			resolve = r;
		});
		const load = vi.fn(async () => promise);
		const cache = createTtlCache<string>({ expirationMs: 1000, load });

		const a = cache.get();
		const b = cache.get();
		const c = cache.get();
		expect(load).toHaveBeenCalledTimes(1);

		resolve("shared");
		expect(await a).toBe("shared");
		expect(await b).toBe("shared");
		expect(await c).toBe("shared");
		expect(load).toHaveBeenCalledTimes(1);
	});

	it("supports keyed caches with independent entries", async () => {
		const load = vi.fn(async (key: string | undefined) => `v:${key}`);
		const cache = createTtlCache<string, string>({ expirationMs: 1000, load });

		expect(await cache.get("a")).toBe("v:a");
		expect(await cache.get("b")).toBe("v:b");
		expect(await cache.get("a")).toBe("v:a");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("clear() with no args drops all entries", async () => {
		let counter = 0;
		const load = vi.fn(async () => `v${++counter}`);
		const cache = createTtlCache<string>({ expirationMs: 60_000, load });

		expect(await cache.get()).toBe("v1");
		cache.clear();
		expect(await cache.get()).toBe("v2");
	});

	it("clear(key) drops only that entry", async () => {
		const load = vi.fn(async (key: string | undefined) => `v:${key}`);
		const cache = createTtlCache<string, string>({ expirationMs: 60_000, load });

		await cache.get("a");
		await cache.get("b");
		expect(load).toHaveBeenCalledTimes(2);

		cache.clear("a");
		await cache.get("a");
		await cache.get("b");
		expect(load).toHaveBeenCalledTimes(3);
	});

	it("forwards the abort signal to the loader", async () => {
		const load = vi.fn(async (_key, opts?: { signal?: AbortSignal }) => {
			expect(opts?.signal).toBeInstanceOf(AbortSignal);
			return "ok";
		});
		const cache = createTtlCache<string>({ expirationMs: 1000, load });
		const ctrl = new AbortController();
		await cache.get(undefined, { signal: ctrl.signal });
	});

	it("peek() returns cached value when fresh, undefined when cold/expired", async () => {
		let now = 0;
		const load = vi.fn(async () => "v1");
		const cache = createTtlCache<string>({ expirationMs: 1000, load, now: () => now });

		expect(cache.peek()).toBeUndefined();
		await cache.get();
		expect(cache.peek()).toBe("v1");
		now += 1500;
		expect(cache.peek()).toBeUndefined();
	});

	it("peek() never triggers a load", async () => {
		const load = vi.fn(async () => "v1");
		const cache = createTtlCache<string>({ expirationMs: 1000, load });
		expect(cache.peek()).toBeUndefined();
		expect(load).not.toHaveBeenCalled();
	});

	it("clear() during in-flight load: stale resolve does NOT poison cache", async () => {
		let resolveFirst!: (v: string) => void;
		const firstPromise = new Promise<string>((r) => {
			resolveFirst = r;
		});
		let call = 0;
		const load = vi.fn(async () => {
			call += 1;
			if (call === 1) return firstPromise;
			return "fresh";
		});
		const cache = createTtlCache<string>({ expirationMs: 60_000, load });

		const inflight = cache.get();
		// Mid-flight: clear the cache. The first loader hasn't resolved yet.
		cache.clear();
		// Now resolve the first loader. Existing awaiters see the value...
		resolveFirst("stale");
		expect(await inflight).toBe("stale");
		// ...but it must NOT have been written into entries, so the next
		// `get()` triggers a fresh load (call #2).
		expect(cache.peek()).toBeUndefined();
		expect(await cache.get()).toBe("fresh");
		expect(load).toHaveBeenCalledTimes(2);
	});

	it("clear(key) during in-flight load: only that key is invalidated", async () => {
		const resolvers = new Map<string, (v: string) => void>();
		const load = vi.fn(async (key: string | undefined) => {
			return new Promise<string>((r) => {
				resolvers.set(key ?? "", r);
			});
		});
		const cache = createTtlCache<string, string>({ expirationMs: 60_000, load });

		const a = cache.get("a");
		const b = cache.get("b");
		cache.clear("a");
		resolvers.get("a")?.("a-stale");
		resolvers.get("b")?.("b-fresh");

		expect(await a).toBe("a-stale");
		expect(await b).toBe("b-fresh");
		expect(cache.peek("a")).toBeUndefined();
		expect(cache.peek("b")).toBe("b-fresh");
	});
});
