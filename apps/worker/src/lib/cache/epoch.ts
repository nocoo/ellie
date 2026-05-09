// Generation / epoch helpers for KV-keyed cache invalidation.
//
// See docs/19 §3 (generation / epoch). The pattern:
//   1. A "generation key" stores an opaque token.
//   2. Cache keys embed that token (`g<gen>`); old gens are unreachable.
//   3. To invalidate, `bumpGen` writes a fresh token; reads pick it up.
//
// `Date.now()` alone is unsafe: same-millisecond bumps could collide and let
// a post-bump reader populate the cache under the previous gen. We append a
// `crypto.randomUUID()` suffix so every bump is unique.
//
// IMPORTANT: per reviewer guidance, `getGen` does NOT memoize across the
// module. Module-level memos would leak across requests on a reused isolate.
// A per-request memo (if needed for hot loops) is a Phase 2 concern and must
// live on a request-local object, not here.

import type { Env } from "../env";

const NEW_GEN_TTL = 0; // generation tokens persist; no expirationTtl.

function makeToken(): string {
	return `${Date.now()}-${crypto.randomUUID()}`;
}

/**
 * Resolve the current generation token for `genKey`. If KV has no value (or
 * the read fails), seed a fresh token and write it back so future readers
 * agree on a stable gen. Always returns a non-empty string.
 */
export async function getGen(env: Env, genKey: string): Promise<string> {
	let token: string | null = null;
	try {
		token = await env.KV.get(genKey);
	} catch (err) {
		// KV read failure — fall through to seeding so the cache key is
		// still well-formed; if the seed write also fails we return the
		// in-memory token so the caller can still build a key.
		console.warn(`[cache] gen read failed key=${genKey}`, err);
	}
	if (token && token.length > 0) return token;

	const seeded = makeToken();
	try {
		await env.KV.put(genKey, seeded);
	} catch (err) {
		// Best-effort: the next reader will try again.
		console.warn(`[cache] gen seed write failed key=${genKey}`, err);
	}
	return seeded;
}

/**
 * Write a fresh generation token for `genKey` and return it. Best-effort:
 * KV write failures are swallowed so a transient KV outage cannot block the
 * underlying mutation. The next reader will reseed if necessary.
 *
 * `expirationTtl` is intentionally **not** set on gen tokens: they are tiny
 * and must outlive every cache entry that references them.
 */
export async function bumpGen(env: Env, genKey: string): Promise<string> {
	const token = makeToken();
	try {
		const opts = NEW_GEN_TTL > 0 ? { expirationTtl: NEW_GEN_TTL } : undefined;
		await env.KV.put(genKey, token, opts);
	} catch (err) {
		// Swallow; mutation must not fail because of KV.
		console.warn(`[cache] gen bump write failed key=${genKey}`, err);
	}
	return token;
}
