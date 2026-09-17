import type { Env } from "../env";
import { recordKvOp } from "./metrics";

/** Missing generations share a schema-scoped initial version; reads never seed KV. */
export const INITIAL_CACHE_GENERATION = "0";
export const UNAVAILABLE_CACHE_GENERATION = "!unavailable";

function metricFamily(key: string): string {
	return `generation:${key.replace(/:\d+$/, "")}`;
}

export async function getGen(env: Env, genKey: string): Promise<string> {
	const family = metricFamily(genKey);
	recordKvOp(family, "kv-get");
	try {
		return (await env.KV.get(genKey)) || INITIAL_CACHE_GENERATION;
	} catch {
		recordKvOp(family, "error");
		// The cache wrapper recognizes this literal and bypasses read AND fill.
		return UNAVAILABLE_CACHE_GENERATION;
	}
}

/** Strict primitive. Business invalidation helpers catch failures separately. */
export async function bumpGen(env: Env, genKey: string): Promise<string> {
	const family = metricFamily(genKey);
	const token = `${Date.now()}-${crypto.randomUUID()}`;
	recordKvOp(family, "kv-put");
	try {
		await env.KV.put(genKey, token);
		return token;
	} catch (error) {
		recordKvOp(family, "invalidate-error");
		throw error;
	}
}
