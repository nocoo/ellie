// Unit tests for `apps/worker/src/handlers/admin/ip-lookup.ts` (Phase G.6).
//
// Coverage targets:
//   - Validation: missing / malformed / private / reserved → INVALID_IP
//     with discriminator `details.reason`.
//   - 503 IP_LOOKUP_NOT_CONFIGURED when secret missing.
//   - Cache hit: KV pre-populated → returns `cached: true`, no fetch.
//   - Cache miss success: fetches upstream with X-Api-Key, persists to
//     KV via waitUntil, returns `cached: false` + normalized + raw.
//   - Raw > 8KB: response carries `rawTruncated: true`, raw === {}.
//   - Non-plain-object body → IP_LOOKUP_PARSE_FAILED 502.
//   - Upstream 5xx → IP_LOOKUP_UPSTREAM_<status> 502.
//   - Upstream timeout → IP_LOOKUP_TIMEOUT 504.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ipLookup from "../../../../src/handlers/admin/ip-lookup";
import { createAdminRequest, createMockCtx, createMockKV, makeEnv } from "../../../helpers";

const ORIGINAL_FETCH = globalThis.fetch;

function jsonOk(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
});

function req(qs: string): Request {
	return createAdminRequest("GET", `/api/admin/ip-lookup${qs}`);
}

describe("admin/ip-lookup — validation", () => {
	it("missing ip → 400 INVALID_IP reason=missing", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req(""), env, createMockCtx());
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { reason: string } } };
		expect(body.error.code).toBe("INVALID_IP");
		expect(body.error.details?.reason).toBe("missing");
	});

	it("malformed v4 octet → reason=malformed", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=999.1.1.1"), env, createMockCtx());
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("malformed");
	});

	it("private 10/8 → reason=private", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=10.0.0.5"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("private");
	});

	it("reserved loopback 127/8 → reason=reserved", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=127.0.0.1"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("reserved");
	});

	it("TEST-NET 192.0.2.x → reason=reserved", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=192.0.2.1"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("reserved");
	});

	it("non-IP string → malformed", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=example.com"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("malformed");
	});
});

describe("admin/ip-lookup — secret gating", () => {
	it("missing IP_LOOKUP_API_KEY → 503 IP_LOOKUP_NOT_CONFIGURED", async () => {
		const env = makeEnv(); // no secret
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_NOT_CONFIGURED");
	});
});

describe("admin/ip-lookup — cache hit", () => {
	it("returns KV cached payload with cached:true; does NOT fetch", async () => {
		const cached = {
			ip: "8.8.8.8",
			normalized: { country: "US", region: null, city: null, asn: "15169", org: "Google" },
			raw: { country: "US" },
			rawTruncated: false,
			fetchedAt: 1_700_000_000,
		};
		const env = makeEnv({
			IP_LOOKUP_API_KEY: "k",
			KV: createMockKV({ "ip-lookup:8.8.8.8": JSON.stringify(cached) }),
		});
		const fetchSpy = vi.fn();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { cached: boolean; normalized: { asn: string } } };
		expect(body.data.cached).toBe(true);
		expect(body.data.normalized.asn).toBe("15169");
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("admin/ip-lookup — cache miss success", () => {
	it("fetches with X-Api-Key, persists via waitUntil, returns cached:false", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "secret-k" });
		// Real upstream shape: nested under raw.location with iso2 + isp.
		const fetchSpy = vi.fn(async () =>
			jsonOk({
				ip: "1.1.1.1",
				version: "v4",
				location: {
					country: "Australia",
					province: "Queensland",
					city: "Brisbane",
					isp: "Cloudflare",
					iso2: "AU",
				},
				source: "echo",
			}),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const ctx = createMockCtx();

		const res = await ipLookup.lookup(req("?ip=1.1.1.1"), env, ctx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				cached: boolean;
				rawTruncated: boolean;
				normalized: {
					country: string | null;
					countryIso2: string | null;
					region: string | null;
					city: string | null;
					isp: string | null;
				};
				raw: Record<string, unknown>;
			};
		};
		expect(body.data.cached).toBe(false);
		expect(body.data.rawTruncated).toBe(false);
		expect(body.data.normalized.country).toBe("Australia");
		expect(body.data.normalized.countryIso2).toBe("AU");
		expect(body.data.normalized.region).toBe("Queensland");
		expect(body.data.normalized.city).toBe("Brisbane");
		expect(body.data.normalized.isp).toBe("Cloudflare");
		expect(body.data.raw.source).toBe("echo");

		// Fetched the right URL with the right header
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://echo.nocoo.cloud/api/ip?ip=1.1.1.1");
		const headers = init.headers as Record<string, string>;
		expect(headers["X-Api-Key"]).toBe("secret-k");

		// waitUntil scheduled a put
		expect(ctx._waitUntilPromises.length).toBe(1);
		await Promise.all(ctx._waitUntilPromises);
		const stored = await env.KV.get("ip-lookup:1.1.1.1");
		expect(stored).not.toBeNull();
	});

	it('folds upstream "0" sentinel to null in normalized but keeps raw verbatim', async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () =>
			jsonOk({
				ip: "8.8.8.8",
				location: {
					country: "United States",
					province: "California",
					city: "0",
					isp: "0",
					iso2: "US",
				},
			})) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				normalized: { city: string | null; isp: string | null; country: string | null };
				raw: { location: { city: string; isp: string } };
			};
		};
		expect(body.data.normalized.city).toBeNull();
		expect(body.data.normalized.isp).toBeNull();
		expect(body.data.normalized.country).toBe("United States");
		// raw stays verbatim
		expect(body.data.raw.location.city).toBe("0");
		expect(body.data.raw.location.isp).toBe("0");
	});

	it("falls back to top-level fields when location is absent", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () =>
			jsonOk({
				country: "JP",
				region: "Tokyo",
				city: "Shibuya",
				asn: 123,
				org: "NTT",
			})) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=2.2.2.2"), env, createMockCtx());
		const body = (await res.json()) as {
			data: {
				normalized: {
					country: string | null;
					region: string | null;
					asn: string | null;
					org: string | null;
				};
			};
		};
		expect(body.data.normalized.country).toBe("JP");
		expect(body.data.normalized.region).toBe("Tokyo");
		expect(body.data.normalized.asn).toBe("123");
		expect(body.data.normalized.org).toBe("NTT");
	});
});

describe("admin/ip-lookup — raw 8KB guard", () => {
	it("raw > 8KB (byte length) → rawTruncated=true and raw replaced with {}", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const big = "x".repeat(9_000);
		globalThis.fetch = (async () =>
			jsonOk({ country: "US", filler: big })) as unknown as typeof fetch;

		const res = await ipLookup.lookup(req("?ip=8.8.4.4"), env, createMockCtx());
		const body = (await res.json()) as {
			data: {
				rawTruncated: boolean;
				raw: Record<string, unknown>;
				normalized: { country: string | null };
			};
		};
		expect(body.data.rawTruncated).toBe(true);
		expect(body.data.raw).toEqual({});
		// Normalized is still extracted from upstream before truncation
		expect(body.data.normalized.country).toBe("US");
	});

	it("multi-byte CJK body counted by bytes, not chars (3000 chars × 3B > 8KB)", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		// 3000 CJK chars ≈ 9000 bytes UTF-8, but JS string length is 3000.
		// The byte-length cap should still trigger truncation.
		const cjk = "中".repeat(3_000);
		globalThis.fetch = (async () =>
			jsonOk({ country: "CN", filler: cjk })) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=4.4.4.4"), env, createMockCtx());
		const body = (await res.json()) as { data: { rawTruncated: boolean } };
		expect(body.data.rawTruncated).toBe(true);
	});
});

describe("admin/ip-lookup — upstream failures", () => {
	it("non-object body → IP_LOOKUP_PARSE_FAILED 502", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () => jsonOk(["array", "not", "object"])) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_PARSE_FAILED");
	});

	it("upstream 500 → IP_LOOKUP_UPSTREAM_500 502", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () =>
			new Response("boom", { status: 500 })) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_UPSTREAM_500");
	});

	it("upstream 400 invalid_ip → INVALID_IP 400 reason=upstream_invalid", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: "invalid_ip" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			})) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error: { code: string; details?: { reason?: string } };
		};
		expect(body.error.code).toBe("INVALID_IP");
		expect(body.error.details?.reason).toBe("upstream_invalid");
	});

	it("upstream 400 unrelated body → IP_LOOKUP_UPSTREAM_400 502", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ error: "rate_limited" }), {
				status: 400,
			})) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_UPSTREAM_400");
	});

	it("timeout → IP_LOOKUP_TIMEOUT 504", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () => {
			const err = new Error("timed out");
			err.name = "TimeoutError";
			throw err;
		}) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(504);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_TIMEOUT");
	});

	it("transport error (non-timeout) → IP_LOOKUP_TRANSPORT_ERROR 502", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () => {
			throw new Error("connection refused");
		}) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_TRANSPORT_ERROR");
	});

	it("res.text() throwing → IP_LOOKUP_TRANSPORT_ERROR 502", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () => {
			const r = new Response("ok", { status: 200 });
			Object.defineProperty(r, "text", {
				value: async () => {
					throw new Error("body stream error");
				},
			});
			return r;
		}) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_TRANSPORT_ERROR");
	});

	it("non-JSON body → IP_LOOKUP_PARSE_FAILED 502", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () =>
			new Response("<html>not json</html>", {
				status: 200,
				headers: { "Content-Type": "text/html" },
			})) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("IP_LOOKUP_PARSE_FAILED");
	});
});

describe("admin/ip-lookup — cache resilience", () => {
	it("KV.get throwing → falls through to upstream fetch", async () => {
		const kv = createMockKV();
		(kv.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			throw new Error("kv unavailable");
		});
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k", KV: kv });
		globalThis.fetch = (async () => jsonOk({ country: "US" })) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { cached: boolean } };
		expect(body.data.cached).toBe(false);
	});

	it("malformed cached payload (missing fields) → falls through to fetch", async () => {
		const env = makeEnv({
			IP_LOOKUP_API_KEY: "k",
			KV: createMockKV({ "ip-lookup:8.8.8.8": JSON.stringify({ ip: "8.8.8.8" }) }),
		});
		globalThis.fetch = (async () => jsonOk({ country: "US" })) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=8.8.8.8"), env, createMockCtx());
		const body = (await res.json()) as { data: { cached: boolean } };
		expect(body.data.cached).toBe(false);
	});
});

describe("admin/ip-lookup — IPv6 validation", () => {
	it("loopback ::1 → reserved", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=%3A%3A1"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("reserved");
	});

	it("ULA fc00::1 → private", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=fc00%3A%3A1"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("private");
	});

	it("link-local fe80::1 → reserved", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=fe80%3A%3A1"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("reserved");
	});

	it("global v6 2606:4700:4700::1111 → fetches upstream", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () => jsonOk({ country: "DE" })) as unknown as typeof fetch;
		const res = await ipLookup.lookup(
			req("?ip=2606%3A4700%3A4700%3A%3A1111"),
			env,
			createMockCtx(),
		);
		expect(res.status).toBe(200);
	});

	it("malformed v6 (only colon) → malformed", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=%3A"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("malformed");
	});
});
