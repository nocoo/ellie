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
 *     is invalidated by a per-key generation token: its result is
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
	const { expirationMs, load } = opts;
	const now = opts.now ?? Date.now;
	const entries = new Map<string, Entry<T>>();
	// In-flight loads tracked by a per-call flight ID so we can detect
	// "this flight was superseded by a `clear`" without comparing Promise
	// references (which would be a self-reference at construction time).
	let nextFlightId = 0;
	const inFlight = new Map<string, { id: number; promise: Promise<T> }>();
	// Per-key generation token. Incremented on every `clear` (single key
	// or full clear). An in-flight load captures the token at start; if
	// the token has changed by resolve time, its result is returned to
	// the awaiters but is NOT written into `entries` — the cache was
	// invalidated mid-flight.
	const generations = new Map<string, number>();

	function bumpGeneration(k: string): void {
		generations.set(k, (generations.get(k) ?? 0) + 1);
	}

	return {
		get(key?: K, callOpts?: { signal?: AbortSignal }): Promise<T> {
			const k = normalizeKey<K>(key);
			const hit = entries.get(k);
			if (hit && now() < hit.expiresAt) {
				return Promise.resolve(hit.value);
			}
			const flight = inFlight.get(k);
			if (flight) return flight.promise;

			const generationAtStart = generations.get(k) ?? 0;
			const flightId = ++nextFlightId;
			const promise = (async () => {
				try {
					const value = await load(key, callOpts);
					if ((generations.get(k) ?? 0) === generationAtStart) {
						entries.set(k, { value, expiresAt: now() + expirationMs });
					}
					return value;
				} finally {
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
				for (const k of new Set([...entries.keys(), ...inFlight.keys()])) {
					bumpGeneration(k);
				}
				entries.clear();
				inFlight.clear();
				return;
			}
			const k = normalizeKey<K>(key);
			bumpGeneration(k);
			entries.delete(k);
			inFlight.delete(k);
		},
	};
}
