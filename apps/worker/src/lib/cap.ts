import { confirmedRun } from "./d1-write";
import type { Env } from "./env";

export const CAP_SCOPE = "ellie";

export const CAP_CHALLENGE_COUNT = 20;
export const CAP_CHALLENGE_DIFFICULTY = 4;
export const CAP_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const CAP_REDEEM_TTL_MS = 20 * 60 * 1000;
export const CAP_CHALLENGE_IP_LIMIT = 30;
export const CAP_CHALLENGE_IP_WINDOW_SEC = 300;

export type CapConsumeResult = "ok" | "required" | "invalid" | "unavailable";

const UNIQUE_ERROR_RE = /UNIQUE\s+constraint\s+failed/i;

export function readCapToken(body: unknown): string {
	if (!body || typeof body !== "object") return "";
	const token = (body as { capToken?: unknown }).capToken;
	return typeof token === "string" ? token.trim() : "";
}

export async function consumeCapToken(env: Env, token: unknown): Promise<CapConsumeResult> {
	if (!env.CAP_SECRET) return "unavailable";
	if (typeof token !== "string" || token.trim() === "") return "required";
	const row = await env.DB.prepare(
		"DELETE FROM cap_tokens WHERE token = ? AND expires_at > ? RETURNING token",
	)
		.bind(token.trim(), Date.now())
		.first<{ token: string }>();
	return row?.token ? "ok" : "invalid";
}

export async function storeCapToken(env: Env, token: string, expiresAt: number): Promise<void> {
	await confirmedRun(
		env.DB.prepare("INSERT INTO cap_tokens (token, expires_at) VALUES (?, ?)").bind(
			token,
			expiresAt,
		),
	);
}

export async function consumeCapNonce(
	env: Env,
	signatureHex: string,
	ttlMs: number,
): Promise<boolean> {
	try {
		await confirmedRun(
			env.DB.prepare("INSERT INTO cap_nonces (signature_hex, expires_at) VALUES (?, ?)").bind(
				signatureHex,
				Date.now() + ttlMs,
			),
		);
		return true;
	} catch (error) {
		if (error instanceof Error && UNIQUE_ERROR_RE.test(error.message)) return false;
		throw error;
	}
}

export async function takeChallengeSlot(env: Env, ip: string): Promise<boolean> {
	const windowStart =
		Math.floor(Date.now() / 1000 / CAP_CHALLENGE_IP_WINDOW_SEC) * CAP_CHALLENGE_IP_WINDOW_SEC;
	const row = await env.DB.prepare(
		`INSERT INTO cap_challenge_ip (ip, window_start, count)
		 VALUES (?, ?, 1)
		 ON CONFLICT(ip) DO UPDATE SET
		   count = CASE WHEN cap_challenge_ip.window_start = excluded.window_start THEN cap_challenge_ip.count + 1 ELSE 1 END,
		   window_start = excluded.window_start
		 RETURNING count`,
	)
		.bind(ip, windowStart)
		.first<{ count: number }>();
	return (row?.count ?? CAP_CHALLENGE_IP_LIMIT + 1) <= CAP_CHALLENGE_IP_LIMIT;
}
