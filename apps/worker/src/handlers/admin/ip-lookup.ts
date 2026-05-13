// Admin IP lookup — Phase G.6.
//
// Single endpoint: GET /api/admin/ip-lookup?ip=<addr>
//
// Pipeline:
//   1. Validate `ip` query param (presence + shape + non-private/reserved).
//      All validation failures collapse to `INVALID_IP` with a discriminator
//      `details.reason: "missing" | "malformed" | "private" | "reserved" |
//      "upstream_invalid"` so the admin UI shows a single normalized message.
//   2. Cache lookup in `ip-lookup:<ip>` (KV). Hit → return cached payload
//      with `cached: true`.
//   3. Miss → fetch upstream `https://echo.nocoo.cloud/api/ip?ip=<ip>` with
//      a 5s timeout and `X-Api-Key: <env.IP_LOOKUP_API_KEY>` header. The
//      secret lives ONLY in the worker (`wrangler secret put
//      IP_LOOKUP_API_KEY`); admin BFF never sees it.
//   4. Parse upstream response. Two guards:
//      - response body must be a plain JSON object → otherwise
//        `IP_LOOKUP_PARSE_FAILED` (502).
//      - raw stringified body > 8 KiB → set `rawTruncated: true` and
//        replace `raw` with `{}` so the cached payload stays bounded.
//        ≤ 8 KiB → keep raw verbatim alongside normalized fields.
//   5. Persist to KV with 24h TTL via `ctx.waitUntil(env.KV.put(...))` so
//      the response path stays unblocked. We use manual KV get/put rather
//      than `cacheGetOrSet` because the value envelope (`normalized` +
//      `raw` + `rawTruncated` + `fetchedAt`) is bespoke and we want
//      explicit control over the truncation guard before anything reaches
//      KV.
//
// Auth: Key B (router-level) + `withEntityAuth` no-op identity wrapper.
// No role gate beyond admin; the handler is read-only and the cached
// values are PII-adjacent geo/ASN data.

import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

/** Cache TTL for ip-lookup KV entries (24h). Mirrors KV registry spec. */
const IP_LOOKUP_TTL_SEC = 86_400;
/** Upstream fetch timeout (ms). Matches dove client. */
const IP_LOOKUP_TIMEOUT_MS = 5_000;
/** Maximum bytes of raw upstream JSON we persist verbatim. */
const RAW_MAX_BYTES = 8 * 1024;

const PRIVATE_V4_RANGES: Array<[number, number]> = [
	// 10.0.0.0/8
	[ipv4ToInt("10.0.0.0"), ipv4ToInt("10.255.255.255")],
	// 172.16.0.0/12
	[ipv4ToInt("172.16.0.0"), ipv4ToInt("172.31.255.255")],
	// 192.168.0.0/16
	[ipv4ToInt("192.168.0.0"), ipv4ToInt("192.168.255.255")],
];

const RESERVED_V4_RANGES: Array<[number, number]> = [
	// 0.0.0.0/8
	[0, ipv4ToInt("0.255.255.255")],
	// 127.0.0.0/8 (loopback)
	[ipv4ToInt("127.0.0.0"), ipv4ToInt("127.255.255.255")],
	// 169.254.0.0/16 (link-local)
	[ipv4ToInt("169.254.0.0"), ipv4ToInt("169.254.255.255")],
	// 100.64.0.0/10 (CGNAT)
	[ipv4ToInt("100.64.0.0"), ipv4ToInt("100.127.255.255")],
	// 192.0.2.0/24 / 198.51.100.0/24 / 203.0.113.0/24 (TEST-NET docs)
	[ipv4ToInt("192.0.2.0"), ipv4ToInt("192.0.2.255")],
	[ipv4ToInt("198.51.100.0"), ipv4ToInt("198.51.100.255")],
	[ipv4ToInt("203.0.113.0"), ipv4ToInt("203.0.113.255")],
	// 224.0.0.0/4 (multicast)
	[ipv4ToInt("224.0.0.0"), ipv4ToInt("239.255.255.255")],
	// 240.0.0.0/4 (reserved future)
	[ipv4ToInt("240.0.0.0"), 0xff_ff_ff_ff],
];

function ipv4ToInt(ip: string): number {
	const parts = ip.split(".");
	if (parts.length !== 4) return -1;
	let n = 0;
	for (const p of parts) {
		const o = Number(p);
		if (!Number.isInteger(o) || o < 0 || o > 255) return -1;
		n = (n << 8) + o;
	}
	return n >>> 0;
}

type ValidationOk = { ok: true; ip: string };
type ValidationFail = {
	ok: false;
	reason: "missing" | "malformed" | "private" | "reserved";
};

function validateIpv4(ip: string): ValidationOk | ValidationFail {
	const n = ipv4ToInt(ip);
	if (n < 0) return { ok: false, reason: "malformed" };
	for (const [lo, hi] of PRIVATE_V4_RANGES) {
		if (n >= lo && n <= hi) return { ok: false, reason: "private" };
	}
	for (const [lo, hi] of RESERVED_V4_RANGES) {
		if (n >= lo && n <= hi) return { ok: false, reason: "reserved" };
	}
	return { ok: true, ip };
}

function validateIpv6(ip: string): ValidationOk | ValidationFail {
	let host: string;
	try {
		const u = new URL(`http://[${ip}]/`);
		host = u.hostname.replace(/^\[|\]$/g, "");
	} catch {
		return { ok: false, reason: "malformed" };
	}
	if (!host) return { ok: false, reason: "malformed" };
	if (host === "::1" || host === "::") return { ok: false, reason: "reserved" };
	// fc00::/7 ULA
	if (/^fc/.test(host) || /^fd/.test(host)) return { ok: false, reason: "private" };
	// fe80::/10 link-local
	if (/^fe[89ab]/.test(host)) return { ok: false, reason: "reserved" };
	// 2001:db8::/32 documentation block (RFC 3849)
	if (/^2001:0*db8(:|$)/.test(host)) return { ok: false, reason: "reserved" };
	return { ok: true, ip: host };
}

/**
 * Validate the queried IP. Accepts only literal IPv4 / IPv6 strings; we
 * intentionally reject hostnames, CIDR notation, and any IPv6 form that
 * uses zone identifiers ("fe80::1%en0").
 *
 * Private / reserved ranges are rejected because the upstream provider
 * either errors or returns junk for them, and admins querying a private
 * address is almost always a misclick from copy-pasting a header.
 */
function validateIp(raw: string | null): ValidationOk | ValidationFail {
	if (!raw) return { ok: false, reason: "missing" };
	const ip = raw.trim();
	if (!ip) return { ok: false, reason: "missing" };
	if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return validateIpv4(ip);
	if (ip.includes(":")) return validateIpv6(ip);
	return { ok: false, reason: "malformed" };
}

/**
 * Cache envelope persisted to KV. `raw` is the upstream JSON when small
 * enough to keep verbatim; otherwise `rawTruncated: true` and `raw === {}`.
 *
 * `normalized` follows the actual echo.nocoo upstream shape, which nests
 * geo data under `raw.location.{country, province, city, isp, iso2}`. We
 * keep `asn` / `org` as optional fields so future provider extensions
 * can flow through without a schema bump, but they are NOT synthesized
 * if absent. The upstream sentinel `"0"` (used for unknown city/isp) is
 * folded to `null` in normalized; raw stays verbatim.
 */
interface IpLookupCachedPayload {
	ip: string;
	normalized: {
		country: string | null;
		countryIso2: string | null;
		region: string | null;
		city: string | null;
		isp: string | null;
		asn: string | null;
		org: string | null;
	};
	raw: Record<string, unknown>;
	rawTruncated: boolean;
	fetchedAt: number;
}

/** Treat the upstream sentinel `"0"` (unknown) as null. */
function nullIfSentinel(s: string | null): string | null {
	return s === "0" ? null : s;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
	for (const k of keys) {
		const v = obj[k];
		if (typeof v === "string" && v.trim()) return v.trim();
		if (typeof v === "number" && Number.isFinite(v)) return String(v);
	}
	return null;
}

function pickLocationString(
	location: Record<string, unknown> | null,
	top: Record<string, unknown>,
	locKeys: string[],
	topKeys: string[],
): string | null {
	if (location) {
		const v = pickString(location, ...locKeys);
		if (v !== null) return v;
	}
	return pickString(top, ...topKeys);
}

function buildNormalized(raw: Record<string, unknown>): IpLookupCachedPayload["normalized"] {
	const loc =
		raw.location && typeof raw.location === "object" && !Array.isArray(raw.location)
			? (raw.location as Record<string, unknown>)
			: null;

	return {
		country: nullIfSentinel(
			pickLocationString(loc, raw, ["country", "country_name"], ["country", "country_name"]),
		),
		countryIso2: nullIfSentinel(
			pickLocationString(
				loc,
				raw,
				["iso2", "country_code", "countryCode"],
				["iso2", "country_code", "countryCode"],
			),
		),
		region: nullIfSentinel(
			pickLocationString(
				loc,
				raw,
				["province", "region", "region_name", "state"],
				["region", "region_name", "state"],
			),
		),
		city: nullIfSentinel(pickLocationString(loc, raw, ["city"], ["city"])),
		isp: nullIfSentinel(
			pickLocationString(loc, raw, ["isp", "org", "organization"], ["isp", "org", "organization"]),
		),
		asn: nullIfSentinel(pickString(raw, "asn", "as", "autonomous_system_number")),
		org: nullIfSentinel(pickString(raw, "org", "organization", "as_name")),
	};
}

async function readCached(env: Env, ip: string): Promise<IpLookupCachedPayload | null> {
	let raw: unknown;
	try {
		raw = await env.KV.get(`ip-lookup:${ip}`, "json");
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	if (typeof r.ip !== "string") return null;
	if (typeof r.fetchedAt !== "number") return null;
	if (typeof r.rawTruncated !== "boolean") return null;
	if (!r.normalized || typeof r.normalized !== "object") return null;
	if (!r.raw || typeof r.raw !== "object") return null;
	return r as unknown as IpLookupCachedPayload;
}

async function fetchUpstream(
	env: Env,
	ip: string,
): Promise<
	| { ok: true; rawText: string; parsed: Record<string, unknown> }
	| { ok: false; code: string; status: number; reason?: string }
> {
	const url = `https://echo.nocoo.cloud/api/ip?ip=${encodeURIComponent(ip)}`;
	let res: Response;
	try {
		res = await fetch(url, {
			method: "GET",
			headers: {
				"X-Api-Key": env.IP_LOOKUP_API_KEY ?? "",
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(IP_LOOKUP_TIMEOUT_MS),
		});
	} catch (err) {
		const code =
			err instanceof Error && err.name === "TimeoutError"
				? "IP_LOOKUP_TIMEOUT"
				: "IP_LOOKUP_TRANSPORT_ERROR";
		return { ok: false, code, status: 0 };
	}

	if (!res.ok) {
		// Special case: upstream 400 with an invalid_ip token in the body
		// should surface to the admin as INVALID_IP, not "upstream failed".
		// We read the body in full and only inspect the first 512 chars
		// for the token; the body itself is not retained anywhere. This
		// is NOT a streaming partial read — if the upstream ever returns
		// pathologically large 400 bodies, switch to a `Reader.read()`
		// loop with an early break.
		if (res.status === 400) {
			let snippet = "";
			try {
				snippet = (await res.text()).slice(0, 512).toLowerCase();
			} catch {
				/* ignore */
			}
			if (snippet.includes("invalid_ip") || snippet.includes("invalid ip")) {
				return {
					ok: false,
					code: "INVALID_IP",
					status: 400,
					reason: "upstream_invalid",
				};
			}
		}
		return {
			ok: false,
			code: `IP_LOOKUP_UPSTREAM_${res.status}`,
			status: res.status,
		};
	}

	let rawText: string;
	try {
		rawText = await res.text();
	} catch {
		return { ok: false, code: "IP_LOOKUP_TRANSPORT_ERROR", status: res.status };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		return { ok: false, code: "IP_LOOKUP_PARSE_FAILED", status: res.status };
	}
	// Reject arrays / primitives — guard 4 from the design spec.
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, code: "IP_LOOKUP_PARSE_FAILED", status: res.status };
	}

	return { ok: true, rawText, parsed: parsed as Record<string, unknown> };
}

function buildPayload(
	ip: string,
	rawText: string,
	parsed: Record<string, unknown>,
): IpLookupCachedPayload {
	// Cap by byte length, not JS string length — non-ASCII bodies (CJK
	// city/isp names) would otherwise undercount and slip past the cap.
	const truncated = new TextEncoder().encode(rawText).byteLength > RAW_MAX_BYTES;
	return {
		ip,
		normalized: buildNormalized(parsed),
		raw: truncated ? {} : parsed,
		rawTruncated: truncated,
		fetchedAt: Math.floor(Date.now() / 1000),
	};
}

async function lookupHandler(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const validation = validateIp(url.searchParams.get("ip"));
	if (!validation.ok) {
		return errorResponse("INVALID_IP", 400, { reason: validation.reason }, origin);
	}
	const { ip } = validation;

	if (!env.IP_LOOKUP_API_KEY) {
		return errorResponse("IP_LOOKUP_NOT_CONFIGURED", 503, undefined, origin);
	}

	// Cache hit
	const cached = await readCached(env, ip);
	if (cached) {
		return jsonResponse({ ...cached, cached: true }, origin);
	}

	// Miss → upstream
	const upstream = await fetchUpstream(env, ip);
	if (!upstream.ok) {
		if (upstream.code === "INVALID_IP") {
			return errorResponse(
				"INVALID_IP",
				400,
				{ reason: upstream.reason ?? "upstream_invalid" },
				origin,
			);
		}
		const status = upstream.code === "IP_LOOKUP_TIMEOUT" ? 504 : 502;
		return errorResponse(upstream.code, status, { upstreamStatus: upstream.status }, origin);
	}

	const payload = buildPayload(ip, upstream.rawText, upstream.parsed);

	// Persist via waitUntil — never block the response on KV write.
	const putPromise = env.KV.put(`ip-lookup:${ip}`, JSON.stringify(payload), {
		expirationTtl: IP_LOOKUP_TTL_SEC,
	}).catch(() => {
		/* swallow — best-effort cache write */
	});
	if (ctx?.waitUntil) {
		ctx.waitUntil(putPromise);
	}

	return jsonResponse({ ...payload, cached: false }, origin);
}

export const lookup = lookupHandler;
