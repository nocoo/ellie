import { generateChallenge, validateChallenge } from "capjs-core";
import {
	CAP_CHALLENGE_COUNT,
	CAP_CHALLENGE_DIFFICULTY,
	CAP_CHALLENGE_TTL_MS,
	CAP_REDEEM_TTL_MS,
	CAP_SCOPE,
	consumeCapNonce,
	storeCapToken,
	takeChallengeSlot,
} from "../lib/cap";
import { extractTrustedClientIp } from "../lib/clientIp";
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";

const RATE_LIMIT_IP_WHITELIST: ReadonlySet<string> = new Set(["74.226.88.37"]);

function capJson(body: unknown, status: number, origin?: string): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...corsHeaders(origin),
			"Content-Type": "application/json",
		},
	});
}

export async function challenge(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	if (!env.CAP_SECRET) {
		return capJson({ success: false, error: "captcha_unavailable" }, 503, origin);
	}

	const ip = extractTrustedClientIp(request, env);
	if (!ip) {
		return capJson({ success: false, error: "missing_client_ip" }, 400, origin);
	}

	if (!RATE_LIMIT_IP_WHITELIST.has(ip) && !(await takeChallengeSlot(env, ip))) {
		return capJson({ success: false, error: "rate_limited" }, 429, origin);
	}

	const testLane = env.ENVIRONMENT === "test";
	const issued = await generateChallenge(env.CAP_SECRET, {
		challengeCount: testLane ? 4 : CAP_CHALLENGE_COUNT,
		challengeDifficulty: testLane ? 2 : CAP_CHALLENGE_DIFFICULTY,
		expiresMs: CAP_CHALLENGE_TTL_MS,
		scope: CAP_SCOPE,
	});
	return capJson(issued, 200, origin);
}

export async function redeem(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	if (!env.CAP_SECRET) {
		return capJson({ success: false, error: "captcha_unavailable" }, 503, origin);
	}

	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return capJson({ success: false, error: "invalid_body" }, 400, origin);
	}

	if (
		!parsed ||
		typeof parsed !== "object" ||
		typeof (parsed as { token?: unknown }).token !== "string" ||
		!Array.isArray((parsed as { solutions?: unknown }).solutions)
	) {
		return capJson({ success: false, error: "invalid_body" }, 400, origin);
	}

	const body = parsed as { token: string; solutions: number[] };
	const result = await validateChallenge(env.CAP_SECRET, body, {
		scope: CAP_SCOPE,
		tokenTtlMs: CAP_REDEEM_TTL_MS,
		consumeNonce: (sigHex, ttlMs) => consumeCapNonce(env, sigHex, ttlMs),
	});
	if (!result.success) {
		return capJson({ success: false, error: result.reason }, 400, origin);
	}

	const ttlMs = result.expires - Date.now();
	if (ttlMs < 1000) {
		return capJson({ success: false, error: "expired" }, 400, origin);
	}
	await storeCapToken(env, result.token, result.expires);
	return capJson({ success: true, token: result.token, expires: result.expires }, 200, origin);
}
