import type { Env } from "./env";

export const CAP_SCOPE = "ellie";
export const CAP_TOKEN_PREFIX = "cap-token:";
export const CAP_NONCE_PREFIX = "cap-nonce:";
export const CAP_CHALLENGE_IP_PREFIX = "cap-chal-ip:";

export const CAP_CHALLENGE_COUNT = 20;
export const CAP_CHALLENGE_DIFFICULTY = 4;
export const CAP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const CAP_REDEEM_TTL_MS = 20 * 60 * 1000;
export const CAP_CHALLENGE_IP_LIMIT = 30;
export const CAP_CHALLENGE_IP_WINDOW_SEC = 300;

export type CapConsumeResult = "ok" | "required" | "invalid" | "unavailable";

export function kvTtlSec(ms: number): number {
	return Math.max(60, Math.ceil(ms / 1000));
}

export function readCapToken(body: unknown): string {
	if (!body || typeof body !== "object") return "";
	const token = (body as { capToken?: unknown }).capToken;
	return typeof token === "string" ? token.trim() : "";
}

export async function consumeCapToken(env: Env, token: unknown): Promise<CapConsumeResult> {
	if (!env.CAP_SECRET) return "unavailable";
	if (typeof token !== "string" || token.trim() === "") return "required";
	const key = `${CAP_TOKEN_PREFIX}${token.trim()}`;
	const stored = await env.KV.get(key);
	if (!stored) return "invalid";
	await env.KV.delete(key);
	return "ok";
}

export async function consumeCapNonce(
	env: Env,
	signatureHex: string,
	ttlMs: number,
): Promise<boolean> {
	const key = `${CAP_NONCE_PREFIX}${signatureHex}`;
	if (await env.KV.get(key)) return false;
	await env.KV.put(key, "1", { expirationTtl: kvTtlSec(ttlMs) });
	return true;
}
