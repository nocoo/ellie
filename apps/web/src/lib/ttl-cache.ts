/**
 * TTL cache with concurrency deduplication.
 *
 * Phase B (cache-layer abstraction): single home for browser/edge in-memory
 * caches with a time-to-live. Replaces ad-hoc `cachedData / cacheExpiry /
 * CACHE_TTL` module-level state in `hooks/use-feature-flags.ts` and
 * `proxy.ts`.
 *
 * Design points:
 *   - `get(key?, opts?)` returns the cached value if not expired; otherwise
 *     calls `load(key, opts)`, stores it, and returns it.
 *   - `peek(key?)` is a synchronous read: returns the cached value if it
 *     exists and is not expired, otherwise `undefined`. Never triggers a
 *     load. Useful for hooks that want to seed React state without
 *     waiting on an effect.
 *   - Concurrent calls for the same key share the same in-flight Promise
 *     (single load, no thundering herd).
 *   - A failed load (rejected loader) does NOT write the cache; the next
 *     call retries.
 *   - `clear(key?)` empties one entry (or all entries when called with no
 *     key / `undefined`). Any in-flight load that resolves AFTER `clear`
 *     is invalidated by removing its flight identity: its result is
 *     returned to existing awaiters but is NOT written back into the
 *     cache, so the next `get()` will re-load.
 *   - The "no key" ergonomics for caches with a single value: callers can
 *     just call `cache.get()` and `cache.clear()`; internally the value is
 *     keyed under `__default`.
 *   - This file is the ONLY allowed home for in-memory TTL state in
 *     `apps/web/src/`. Enforced by
 *     `tests/unit/architecture/no-adhoc-cache.test.ts`.
 *
 * NOT a replacement for React `cache()`; that is a per-render dedupe and
 * lives in `lib/forum-cache.ts`.
 */

const DEFAULT_KEY = "__default";

export interface TtlCacheOptions<T, K> {
	/** Time-to-live in milliseconds. */
	expirationMs: number;
	maxEntries?: number;
	/**
	 * Loader. Called when the cache misses or expires. Reject → cache
	 * untouched, the next `get` retries.
	 *
	 * @param key   The lookup key (or `undefined` for void-keyed caches).
	 * @param opts  Forwarded from `get()` (typically `{ signal }`).
	 */
	load: (key: K | undefined, opts?: { signal?: AbortSignal }) => Promise<T>;
	/**
	 * Optional clock injection for tests. Defaults to `Date.now`.
	 */
	now?: () => number;
}

interface Entry<T> {
	value: T;
	expiresAt: number;
}

export interface TtlCache<T, K = void> {
	get(key?: K, opts?: { signal?: AbortSignal }): Promise<T>;
	peek(key?: K): T | undefined;
	clear(key?: K): void;
}

function normalizeKey<K>(key: K | undefined): string {
	if (key === undefined) return DEFAULT_KEY;
	if (typeof key === "string") return `s:${key}`;
	if (typeof key === "number" || typeof key === "boolean") return `p:${String(key)}`;
	return `j:${JSON.stringify(key)}`;
}

export function createTtlCache<T, K = void>(opts: TtlCacheOptions<T, K>): TtlCache<T, K> {
	const { expirationMs, load, maxEntries = Number.POSITIVE_INFINITY } = opts;
	if (maxEntries < 1) throw new Error("Cache capacity must be positive");
	let activeLoads = 0;
	const now = opts.now ?? Date.now;
	const entries = new Map<string, Entry<T>>();
	const inFlight = new Map<string, { id: symbol; promise: Promise<T> }>();

	return {
		get(key?: K, callOpts?: { signal?: AbortSignal }): Promise<T> {
			const k = normalizeKey<K>(key);
			const hit = entries.get(k);
			if (hit && now() < hit.expiresAt) {
				return Promise.resolve(hit.value);
			}
			const flight = inFlight.get(k);
			if (flight) return flight.promise;

			entries.delete(k);
			while (entries.size + inFlight.size >= maxEntries && entries.size > 0) {
				const oldest = entries.keys().next().value;
				if (oldest !== undefined) entries.delete(oldest);
			}
			if (activeLoads >= maxEntries)
				return Promise.reject(new Error("Cache load capacity exceeded"));
			activeLoads++;
			const flightId = Symbol();
			const promise = (async () => {
				try {
					const value = await load(key, callOpts);
					if (inFlight.get(k)?.id === flightId) {
						entries.set(k, { value, expiresAt: now() + expirationMs });
					}
					return value;
				} finally {
					activeLoads--;
					const current = inFlight.get(k);
					if (current && current.id === flightId) inFlight.delete(k);
				}
			})();
			inFlight.set(k, { id: flightId, promise });
			return promise;
		},
		peek(key?: K): T | undefined {
			const k = normalizeKey<K>(key);
			const hit = entries.get(k);
			if (hit && now() < hit.expiresAt) return hit.value;
			return undefined;
		},
		clear(key?: K): void {
			if (key === undefined) {
				entries.clear();
				inFlight.clear();
				return;
			}
			const k = normalizeKey<K>(key);
			entries.delete(k);
			inFlight.delete(k);
		},
	};
}
