// clientIp.ts — Phase G.1 unified client-IP extraction.
//
// Production deployment topology (CF orange-cloud → Docker → Worker):
//   * The CF edge sets `CF-Connecting-IP` to the real client IP and CANNOT be
//     spoofed. Any reverse proxy in front of the Worker MUST forward this
//     header verbatim. If a hop strips it, the fix is in proxy config — we
//     refuse to fall back to client-controlled headers in production.
//   * Server-to-Worker calls (Next admin BFF / Next forum BFF) attach
//     `X-Real-IP` carrying the originating user IP. Because those callers
//     authenticate with Worker admin/forum API keys, the header is only
//     trusted when the request itself is server-to-Worker (Key A or Key B
//     present).
//   * `X-Forwarded-For` is client-controllable and is ONLY accepted in
//     non-production environments to keep local dev / vitest ergonomic.
//
// Two helpers live here:
//   - `isServerToWorkerRequest(request, env)` — true when the request carries
//     a valid `X-API-Key` matching the public forum key (`API_KEY`) or admin
//     key (`ADMIN_API_KEY`). Used to gate `X-Real-IP` trust.
//   - `extractTrustedClientIp(request, env, opts?)` — returns the canonical
//     client IP, or `null` when no trustworthy source is present. Callers
//     decide whether to hard-reject (auth) or fall through to empty string
//     (write-side audit fields where empty is acceptable but a forged value
//     is not).

import type { Env } from "./env";

export interface ExtractClientIpOptions {
	/**
	 * Allow `X-Forwarded-For` (first hop) as a last-resort fallback. Only
	 * honored when `env.ENVIRONMENT !== "production"`. Defaults to true so
	 * vitest unit tests don't have to pass it explicitly.
	 */
	allowXffInNonProd?: boolean;
	/**
	 * Explicit opt-in for endpoints that authenticate via a NON Key A/B
	 * secret and therefore cannot be classified as server-to-Worker by
	 * `isServerToWorkerRequest`. Example: the P5 analytics ingest route
	 * authenticates with its own `X-Ingest-Key` and only sets this flag
	 * AFTER the secret has been constant-time verified.
	 *
	 * Callers MUST verify their own secret BEFORE passing this flag — the
	 * helper does not know how the caller authenticated, only that the
	 * caller has earned the right to trust `X-Real-IP`. Tests must pin
	 * that no untrusted code path can reach the helper with this flag
	 * set.
	 */
	trustXRealIp?: boolean;
}

export function isServerToWorkerRequest(request: Request, env: Env): boolean {
	const apiKey = request.headers.get("X-API-Key") ?? request.headers.get("x-api-key");
	if (!apiKey) return false;
	return apiKey === env.API_KEY || apiKey === env.ADMIN_API_KEY;
}

/**
 * Extract a trustworthy client IP from the request.
 *
 * Priority:
 *   1. For server-to-worker requests (Key A/B present) OR when
 *      `opts.trustXRealIp` is explicitly set: prefer `X-Real-IP` — the
 *      BFF forwards the real client IP (resolved from CF-Connecting-IP
 *      on the BFF side) via this header. `CF-Connecting-IP` on the
 *      Worker's inbound request is merely the BFF server's egress IP
 *      (useless for rate limiting / audit).
 *   2. `CF-Connecting-IP` — trusted for direct-to-Worker requests (set
 *      by Cloudflare edge). Also serves as fallback when X-Real-IP is
 *      absent on a server-to-worker request (shouldn't normally happen).
 *   3. First segment of `X-Forwarded-For` — only when running outside
 *      production AND `opts.allowXffInNonProd !== false`.
 *
 * Returns `null` when no trustworthy source is present. Callers pick the
 * downstream behavior:
 *   - login/register hard-reject the request to prevent rate-limit bypass.
 *   - online/comment/admin-log accept the empty string (`?? ""`) and write
 *     it to the audit row so forensics know the IP was unknown rather than
 *     being silently filled in with a forged value.
 */
export function extractTrustedClientIp(
	request: Request,
	env: Env,
	opts: ExtractClientIpOptions = {},
): string | null {
	const isServer = isServerToWorkerRequest(request, env) || opts.trustXRealIp === true;

	// For server-to-worker requests, X-Real-IP is the real client IP
	// (forwarded by the BFF). CF-Connecting-IP is just the BFF egress IP.
	if (isServer) {
		const realIp = request.headers.get("X-Ellie-Client-IP")?.trim();
		if (realIp) return realIp;
	}

	const cf = request.headers.get("CF-Connecting-IP")?.trim();
	if (cf) return cf;

	// Non-server requests: X-Real-IP is not trusted (client-controlled)
	// so we skip it entirely.

	if (opts.allowXffInNonProd !== false && env.ENVIRONMENT !== "production") {
		const xff = request.headers.get("X-Forwarded-For");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return first;
		}
	}

	return null;
}
