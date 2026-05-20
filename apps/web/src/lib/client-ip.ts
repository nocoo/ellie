/**
 * client-ip.ts — Trusted-client-IP resolution for the Next.js edge proxy.
 *
 * This helper centralizes the rule that decides which inbound header
 * the Next runtime should TRUST as the real client IP. The same rule
 * is mirrored on the worker side (`apps/worker/src/lib/clientIp.ts`),
 * but the proxy resolves it once here so the analytics ingest payload
 * carries the canonical value forward as `X-Real-IP`.
 *
 * Trust rules (production):
 *
 *   1. `CF-Connecting-IP` — set by Cloudflare's edge for every request
 *      passing through the zone. We always trust it.
 *   2. (no fallback) — `x-forwarded-for` is NOT honored in production
 *      because clients can forge it. `x-real-ip` is ALSO not honored
 *      inbound to the proxy in production: the proxy is the boundary
 *      that ATTACHES `x-real-ip` to the worker call, but if an inbound
 *      request already carries one, we ignore it (a downstream client
 *      could trivially set it before hitting Cloudflare).
 *
 * Trust rules (development / non-production):
 *
 *   3. As a developer convenience, we accept the first hop of
 *      `x-forwarded-for` and `x-real-ip` so `curl -H` local testing
 *      works. NEVER applied when `process.env.NODE_ENV === "production"`.
 *
 * Returning the empty string when no trusted header is present is
 * intentional: the worker's strict-whitelist body validator only
 * carries `path_kind`/`target_id`/`user_id`, so the ingest endpoint
 * uses the `X-Real-IP` header path (gated by the secret) instead of a
 * body field. Resolving to `""` here causes the proxy to NOT set
 * `X-Real-IP` at all, which the worker handles by falling back to its
 * own (no-op) extractor — no spoofed IP can leak into the aggregate.
 */

import type { NextRequest } from "next/server";

/**
 * Resolve the trusted client IP from a Next.js proxy request.
 *
 * Returns the empty string when no trusted source is available — the
 * caller MUST treat that as "do not forward any IP" rather than
 * substituting an alternative (e.g. headers.get("x-forwarded-for")).
 */
export function resolveTrustedClientIp(request: NextRequest): string {
	const cf = request.headers.get("cf-connecting-ip");
	if (cf && cf.length > 0) return cf;

	// Dev-only fallbacks. Mirrors the worker's non-production XFF rule.
	if (process.env.NODE_ENV !== "production") {
		const xff = request.headers.get("x-forwarded-for");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return first;
		}
		const realIp = request.headers.get("x-real-ip");
		if (realIp && realIp.length > 0) return realIp;
	}

	// Production: no trusted source. Caller MUST NOT forward a spoofed
	// header by reaching into x-forwarded-for here.
	return "";
}

// Test-only export. Production code MUST call `resolveTrustedClientIp`.
export const _internal = {};
