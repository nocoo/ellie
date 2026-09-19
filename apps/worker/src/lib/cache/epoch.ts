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

/** Read each resource version once, using KV's bounded bulk API. */
export async function getGens(env: Env, genKeys: string[]): Promise<Map<string, string>> {
	const result = new Map<string, string>();
	const keys = [...new Set(genKeys)];
	for (let start = 0; start < keys.length; start += 100) {
		const batch = keys.slice(start, start + 100);
		try {
			const values = await env.KV.get(batch, "text");
			if (!(values instanceof Map)) throw new TypeError("Invalid KV bulk response");
			for (const key of batch) result.set(key, values.get(key) || INITIAL_CACHE_GENERATION);
		} catch {
			for (const key of batch) result.set(key, UNAVAILABLE_CACHE_GENERATION);
		}
	}
	return result;
}

/** Strict primitive. Business invalidation helpers catch failures separately. */
export async function bumpGen(env: Env, genKey: string): Promise<string> {
	const token = `${Date.now()}-${crypto.randomUUID()}`;

	await env.KV.put(genKey, token);
	return token;
}
