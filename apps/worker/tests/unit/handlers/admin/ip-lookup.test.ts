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
		const fetchSpy = vi.fn(async () =>
			jsonOk({ country: "JP", region: "Tokyo", city: "Shibuya", asn: 123, org: "NTT" }),
		);
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		const ctx = createMockCtx();

		const res = await ipLookup.lookup(req("?ip=1.1.1.1"), env, ctx);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: {
				cached: boolean;
				rawTruncated: boolean;
				normalized: { country: string | null; asn: string | null };
				raw: Record<string, unknown>;
			};
		};
		expect(body.data.cached).toBe(false);
		expect(body.data.rawTruncated).toBe(false);
		expect(body.data.normalized.country).toBe("JP");
		expect(body.data.normalized.asn).toBe("123");
		expect(body.data.raw.country).toBe("JP");

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
});

describe("admin/ip-lookup — raw 8KB guard", () => {
	it("raw > 8KB → rawTruncated=true and raw replaced with {}", async () => {
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

	it("global v6 2001:db8::1 → fetches upstream", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		globalThis.fetch = (async () => jsonOk({ country: "DE" })) as unknown as typeof fetch;
		const res = await ipLookup.lookup(req("?ip=2001%3Adb8%3A%3A1"), env, createMockCtx());
		expect(res.status).toBe(200);
	});

	it("malformed v6 (only colon) → malformed", async () => {
		const env = makeEnv({ IP_LOOKUP_API_KEY: "k" });
		const res = await ipLookup.lookup(req("?ip=%3A"), env, createMockCtx());
		const body = (await res.json()) as { error: { details?: { reason: string } } };
		expect(body.error.details?.reason).toBe("malformed");
	});
});
