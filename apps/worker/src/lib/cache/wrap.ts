// Generic read-through KV cache wrapper.
//
// See docs/19 §1.3 (correctness vs. TTL): correctness comes from explicit
// invalidation; TTL is a safety net. Each caller declares its own TTL when
// it invokes `cacheGetOrSet`.
//
// The optional `validator` lets each cache entry guard against schema drift:
// if a stored payload no longer matches the current shape (e.g. fields were
// added in code but old payloads still live in KV), the validator returns
// false, and the wrapper treats it as a miss. After `cacheGetOrSet`, all
// callers see a value of type `T` that the validator accepted.

import type { Env } from "../env";

export interface CacheGetOrSetOptions<T> {
	/** TTL in seconds. Required: every cache entry must declare a TTL. */
	ttl: number;
	/**
	 * Optional shape validator. Called on the parsed JSON before it is
	 * returned. Return `false` to force a miss (re-load and re-write).
	 */
	validator?: (value: unknown) => value is T;
}

/**
 * Read-through cache: try KV first; on miss / invalid / KV failure, call
 * `loader`, write the result back via `ctx.waitUntil` (non-blocking on the
 * response path), and return the loaded value.
 *
 * KV failures (read OR write) MUST NOT propagate — the underlying handler
 * keeps working off D1.
 */
export async function cacheGetOrSet<T>(
	env: Env,
	ctx: ExecutionContext,
	key: string,
	loader: () => Promise<T>,
	options: CacheGetOrSetOptions<T>,
): Promise<T> {
	// Read attempt
	try {
		const cached = (await env.KV.get(key, "json")) as unknown;
		if (cached !== null && cached !== undefined) {
			if (!options.validator || options.validator(cached)) {
				return cached as T;
			}
		}
	} catch (err) {
		// KV read failure — log and fall through to loader so the handler
		// keeps working off D1.
		console.warn(`[cache] read miss (KV error) key=${key}`, err);
	}

	// Miss path
	const fresh = await loader();

	// Best-effort write-back; never block the response.
	const putPromise = env.KV.put(key, JSON.stringify(fresh), {
		expirationTtl: options.ttl,
	}).catch((err) => {
		console.warn(`[cache] write-back failed key=${key}`, err);
	});
	ctx.waitUntil(putPromise);

	return fresh;
}
