// Cloudflare Turnstile siteverify client (docs/17 §7.2.1 — rev4).
//
// The `request-code` endpoint requires a fresh Turnstile token from the
// browser widget. We POST it to Cloudflare's siteverify endpoint with the
// shared secret; only `success: true` allows the flow to continue.
//
// Fail-closed: any 5xx, network error, or timeout from Cloudflare maps to
// `false` (rejected). This is intentional — captcha failure must NOT be
// abusable as a bypass.
//
// Test environment uses Cloudflare's documented always-pass keys
// (`1x0000000000000000000000000000000AA` secret / `1x00000000000000000000AA`
// site key) so unit + e2e tests do not require real outbound calls.

import type { Env } from "./env";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5000;

export interface TurnstileVerifyResult {
	/** True iff Cloudflare returned `success: true`. */
	success: boolean;
	/**
	 * Best-effort failure reason for server-side logs only. Never expose
	 * verbatim to the client — it can leak Turnstile config / hostname state.
	 * Examples: `missing-secret`, `invalid-input-response`, `timeout`,
	 * `http_502`, `network_error`.
	 */
	reason?: string;
}

/**
 * Verify a Turnstile response token with Cloudflare's siteverify API.
 *
 * Returns `{ success: true }` only on a 2xx response with `success: true`.
 * Anything else — bad token, missing secret, timeout, 5xx — returns
 * `{ success: false, reason: "<short-tag>" }` so the caller can map all
 * failures to a single `403 CAPTCHA_INVALID` for the client.
 */
export async function verifyTurnstileToken(
	env: Env,
	token: string,
	remoteIp?: string,
): Promise<TurnstileVerifyResult> {
	if (!env.TURNSTILE_SECRET_KEY) {
		return { success: false, reason: "missing-secret" };
	}

	const params = new URLSearchParams();
	params.set("secret", env.TURNSTILE_SECRET_KEY);
	params.set("response", token);
	if (remoteIp) {
		params.set("remoteip", remoteIp);
	}

	let resp: Response;
	try {
		resp = await fetch(SITEVERIFY_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: params.toString(),
			signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
		});
	} catch (err) {
		// AbortError, network error, DNS failure — all map to fail-closed.
		const isTimeout = err instanceof Error && err.name === "TimeoutError";
		return { success: false, reason: isTimeout ? "timeout" : "network_error" };
	}

	if (!resp.ok) {
		return { success: false, reason: `http_${resp.status}` };
	}

	let body: { success?: boolean; "error-codes"?: string[] };
	try {
		body = (await resp.json()) as typeof body;
	} catch {
		return { success: false, reason: "invalid_json" };
	}

	if (body.success === true) {
		return { success: true };
	}

	const codes = Array.isArray(body["error-codes"]) ? body["error-codes"] : [];
	return { success: false, reason: codes[0] ?? "rejected" };
}
