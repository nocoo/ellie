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
 *   1. `CF-Connecting-IP` — always trusted (set by Cloudflare edge).
 *   2. `X-Real-IP` — only when `isServerToWorkerRequest(request, env)` is
 *      true (i.e. the upstream is our own admin / forum BFF using Key A/B).
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
	const cf = request.headers.get("CF-Connecting-IP")?.trim();
	if (cf) return cf;

	const realIp = request.headers.get("X-Real-IP")?.trim();
	if (realIp && isServerToWorkerRequest(request, env)) {
		return realIp;
	}

	if (opts.allowXffInNonProd !== false && env.ENVIRONMENT !== "production") {
		const xff = request.headers.get("X-Forwarded-For");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return first;
		}
	}

	return null;
}
