// client-ip.ts — Phase G.2 helper: extract the originating client IP from an
// incoming admin BFF request so we can forward it to the Worker as
// `X-Real-IP`.
//
// Production deployment topology mirrors G.1's contract on the Worker side:
// admin BFF (Next.js, Node) runs in Docker behind a Cloudflare orange-cloud
// DNS record. CF rewrites `CF-Connecting-IP` to the real client IP and that
// is the ONLY trustworthy header in production. `X-Forwarded-For` is
// client-controllable from the public internet (a reverse proxy in front of
// the BFF can pass arbitrary user-supplied XFF through), so honoring it in
// production would let an attacker upgrade a forged inbound header into a
// Key-B-signed `X-Real-IP` going into the Worker — which the Worker trusts.
//
// Trust ladder (must stay aligned with `apps/worker/src/lib/clientIp.ts`):
//   1. `CF-Connecting-IP` — always trusted.
//   2. First segment of `X-Forwarded-For` — ONLY accepted outside
//      production (`NODE_ENV !== "production"`) so local dev / vitest stays
//      ergonomic. The opts toggle exists for tests that need to exercise
//      the production branch explicitly.
//
// Returns `""` when no trustworthy source is present. Callers always
// forward whatever we return verbatim and the Worker re-validates trust on
// its side via `extractTrustedClientIp` (which also gates X-Real-IP behind
// Key A/B).

import type { NextRequest } from "next/server";

export interface ExtractClientIpOptions {
	/**
	 * Allow `X-Forwarded-For` (first hop) outside production. Defaults to
	 * true so local dev / vitest don't have to pass it explicitly. Set to
	 * false to simulate the production branch in tests regardless of
	 * NODE_ENV.
	 */
	allowXffInNonProd?: boolean;
}

export function extractClientIp(
	request: NextRequest | Request,
	opts: ExtractClientIpOptions = {},
): string {
	const headers = request.headers;
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
