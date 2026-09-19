import type { Env } from "../env";

/** Missing generations share a schema-scoped initial version; reads never seed KV. */
export const INITIAL_CACHE_GENERATION = "0";
export const UNAVAILABLE_CACHE_GENERATION = "!unavailable";

export async function getGen(env: Env, genKey: string): Promise<string> {
	try {
		return (await env.KV.get(genKey)) || INITIAL_CACHE_GENERATION;
	} catch {
		// The cache wrapper recognizes this literal and bypasses read AND fill.
		return UNAVAILABLE_CACHE_GENERATION;
	}
}

/** Strict primitive. Business invalidation helpers catch failures separately. */
export async function bumpGen(env: Env, genKey: string): Promise<string> {
	const token = `${Date.now()}-${crypto.randomUUID()}`;

	await env.KV.put(genKey, token);
	return token;
}
