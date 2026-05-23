// client-ip.ts — Forum BFF helper: extract the originating client IP so we
// can forward it to the Worker as `X-Real-IP` (for per-IP rate limiting and
// analytics ingest).
//
// Deployment topology: Forum BFF (Next.js, Node) runs in Docker behind a
// Cloudflare orange-cloud DNS record. CF rewrites `CF-Connecting-IP` to the
// real client IP and that is the ONLY trustworthy header in production.
//
// Why we MUST NOT honor client-controlled headers in production:
//   * The BFF authenticates to the Worker with Key A. The Worker's
//     `extractTrustedClientIp` trusts `X-Real-IP` whenever the request
//     carries Key A or Key B (see apps/worker/src/lib/clientIp.ts). If the
//     BFF blindly reads an inbound `X-Real-IP` from the public internet and
//     re-emits it under Key A, an attacker can rotate the header to bypass
//     the per-IP login rate limit.
//   * `X-Forwarded-For` is equally client-controllable from the edge —
//     accepted outside production only for local dev / vitest ergonomics.
//
// Trust ladder (kept in lockstep with worker/src/lib/clientIp.ts and
// admin/src/lib/client-ip.ts):
//   1. `x-forwarded-client-ip` — set by our own proxy.ts from the raw
//      NextRequest's `CF-Connecting-IP`. Route handlers receive this via
//      `NextResponse.next({ request: { headers } })`. Trusted because
//      only our proxy can set it (Cloudflare strips unknown headers from
//      external requests before they reach the origin).
//   2. `CF-Connecting-IP` — direct trust from Cloudflare edge.
//   3. First segment of `X-Forwarded-For` — ONLY accepted outside
//      production (NODE_ENV !== "production").
//
// Returns `""` when no trustworthy source is present. The Worker then
// hard-rejects rate-limited endpoints (login/register) or falls back to
// its own (no-op) extractor for analytics, preventing a silently-forged
// IP from being treated as a real one.

import type { NextRequest } from "next/server";

export interface ExtractClientIpOptions {
	/**
	 * Allow `X-Forwarded-For` (first hop) outside production. Defaults to
	 * true so local dev / vitest don't have to pass it explicitly. Set to
	 * false to exercise the production branch in tests regardless of
	 * NODE_ENV.
	 */
	allowXffInNonProd?: boolean;
}

/** Headers-like shape covering both `Request.headers` and `next/headers`. */
export interface ReadOnlyHeaders {
	get(name: string): string | null;
}

/**
 * Extract a trustworthy client IP from a headers bag.
 *
 * Accepts either a `Request`/`NextRequest` instance or any object with a
 * `get(name)` lookup (e.g. the awaited result of `next/headers`).
 */
export function extractClientIp(
	source: { headers: ReadOnlyHeaders } | ReadOnlyHeaders,
	opts: ExtractClientIpOptions = {},
): string {
	const headers: ReadOnlyHeaders =
		"headers" in source &&
		typeof (source as { headers: ReadOnlyHeaders }).headers?.get === "function"
			? (source as { headers: ReadOnlyHeaders }).headers
			: (source as ReadOnlyHeaders);

	const proxyIp = headers.get("x-forwarded-client-ip")?.trim();
	if (proxyIp) return proxyIp;

	const cf = headers.get("cf-connecting-ip")?.trim();
	if (cf) return cf;

	if (opts.allowXffInNonProd !== false && process.env.NODE_ENV !== "production") {
		const xff = headers.get("x-forwarded-for");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return first;
		}
	}

	return "";
}

/**
 * Resolve the trusted client IP from a Next.js proxy request.
 *
 * Used by the analytics ingest path (`apps/web/src/proxy.ts`). Returns the
 * empty string when no trusted source is available — the caller MUST treat
 * that as "do not forward any IP" rather than substituting an alternative
 * (e.g. headers.get("x-forwarded-for")).
 *
 * Differs from {@link extractClientIp} in that, outside production, it
 * also accepts an inbound `X-Real-IP` (dev convenience for `curl -H`
 * testing). NEVER applied when `process.env.NODE_ENV === "production"`.
 */
export function resolveTrustedClientIp(request: NextRequest): string {
	const cf = request.headers.get("cf-connecting-ip");
	if (cf && cf.length > 0) return cf;

	if (process.env.NODE_ENV !== "production") {
		const xff = request.headers.get("x-forwarded-for");
		if (xff) {
			const first = xff.split(",")[0]?.trim();
			if (first) return first;
		}
		const realIp = request.headers.get("x-real-ip");
		if (realIp && realIp.length > 0) return realIp;
	}

	return "";
}
