// client-ip.ts — Phase G.2 helper: extract the originating client IP from an
// incoming admin BFF request so we can forward it to the Worker as
// `X-Real-IP`.
//
// Deployment topology: admin BFF (Next.js, Node) runs in Docker behind a
// Cloudflare orange-cloud DNS record. CF strips any client-set
// `CF-Connecting-IP` and rewrites it to the real edge client IP, so this
// header is the canonical source. We accept `X-Forwarded-For` first segment
// only as a fallback (e.g. when the BFF is reached directly during local
// dev), and return empty string when neither is present — callers always
// forward whatever we return verbatim, and Worker's trust ladder will still
// require the request to carry Key B (we do that via the admin API key) for
// `X-Real-IP` to be honored.
//
// We deliberately do NOT mirror the Worker's "production guard" here: the
// admin BFF only ever talks to the Worker server-to-server with Key B, and
// Worker re-validates trust on its side via `extractTrustedClientIp`.

import type { NextRequest } from "next/server";

export function extractClientIp(request: NextRequest | Request): string {
	const headers = request.headers;
	const cf = headers.get("cf-connecting-ip")?.trim();
	if (cf) return cf;
	const xff = headers.get("x-forwarded-for");
	if (xff) {
		const first = xff.split(",")[0]?.trim();
		if (first) return first;
	}
	return "";
}
