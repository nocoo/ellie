// Admin IP-lookup viewmodel — Phase G.6.3.
//
// Thin client over `GET /api/admin/ip-lookup?ip=<addr>` (BFF passthrough
// to worker). Mirrors the worker contract in
// `apps/worker/src/handlers/admin/ip-lookup.ts` and docs/20 §13A.1.
//
// Errors propagate as `ApiError` from `apiClient` — callers should
// switch on `code`:
//   - INVALID_IP (400)            — local or upstream validation failure
//                                   (`details.reason` discriminates).
//   - IP_LOOKUP_NOT_CONFIGURED    — worker secret unset (503).
//   - IP_LOOKUP_TIMEOUT (504)     — upstream timed out.
//   - IP_LOOKUP_PARSE_FAILED      — upstream returned non-JSON / non-object.
//   - IP_LOOKUP_TRANSPORT_ERROR   — non-timeout network failure.
//   - IP_LOOKUP_UPSTREAM_<status> — other non-2xx upstream.

import { apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types — must stay in lockstep with the worker payload.
// ---------------------------------------------------------------------------

export interface IpLookupNormalized {
	country: string | null;
	countryIso2: string | null;
	region: string | null;
	city: string | null;
	isp: string | null;
	asn: string | null;
	org: string | null;
}

export interface IpLookupResult {
	ip: string;
	cached: boolean;
	normalized: IpLookupNormalized;
	raw: Record<string, unknown>;
	rawTruncated: boolean;
	fetchedAt: number;
}

export interface IpLookupErrorReason {
	reason?: "missing" | "malformed" | "private" | "reserved" | "upstream_invalid";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Look up geolocation / ISP info for a single IP. Pass the IP verbatim
 * (no trimming or canonicalization here — the worker validates).
 */
export async function lookupIp(ip: string): Promise<IpLookupResult> {
	const res = await apiClient.get<IpLookupResult>("/api/admin/ip-lookup", { ip });
	return res.data;
}

// ---------------------------------------------------------------------------
// Display helpers — pure, exported for UI + tests.
// ---------------------------------------------------------------------------

/**
 * One-line summary suitable for inline meta cards: "City, Region, Country
 * (ISP)" with `null` segments dropped. Returns "未知" when nothing is
 * available so the UI never shows an empty string.
 */
export function formatIpLookupSummary(n: IpLookupNormalized): string {
	const parts = [n.city, n.region, n.country].filter((s): s is string => !!s);
	const head = parts.join(", ");
	const tail = n.isp ? ` (${n.isp})` : "";
	const out = `${head}${tail}`.trim();
	return out || "未知";
}

/**
 * Map an `INVALID_IP` `details.reason` to a Chinese label for the UI.
 * Unknown reasons fall back to a generic "IP 无效" so we never surface
 * a raw enum value.
 */
export function describeInvalidIpReason(reason: string | undefined): string {
	switch (reason) {
		case "missing":
			return "未提供 IP";
		case "malformed":
			return "IP 格式错误";
		case "private":
			return "私网地址";
		case "reserved":
			return "保留地址";
		case "upstream_invalid":
			return "上游判定 IP 无效";
		default:
			return "IP 无效";
	}
}
