// ip-lookup BFF proxy test — Phase G.6.2.
//
// Verifies:
//   - GET passes the `?ip=` query straight through to the worker path
//   - X-API-Key (Key B / ADMIN_API_KEY) is set; X-Real-IP comes from
//     the original request
//   - The route never reads or forwards `IP_LOOKUP_API_KEY`. We set
//     a sentinel value in env and assert it appears nowhere in the
//     outgoing fetch URL/headers/body.
//   - The worker JSON envelope (data + error) is returned verbatim,
//     status preserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin", () => ({ resolveAdmin: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
	validateOrigin: vi.fn(() => true),
	getAllowedOrigins: vi.fn(() => ["http://localhost:3000"]),
}));

import { GET } from "@/app/api/admin/ip-lookup/route";
import { auth } from "@/auth";
import { resolveAdmin } from "@/lib/admin";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockResolveAdmin = resolveAdmin as ReturnType<typeof vi.fn>;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let mockFetchFn: ReturnType<typeof vi.fn>;

const SECRET_SENTINEL = "MUST-NEVER-LEAK-IP-LOOKUP-KEY";

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.ADMIN_API_KEY = "test-key";
	// Set the upstream provider secret as a sentinel; if the BFF ever
	// reads it, it will show up in the outgoing fetch and the leak
	// assertions below will fail.
	process.env.IP_LOOKUP_API_KEY = SECRET_SENTINEL;

	mockFetchFn = vi.fn(() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					data: {
						ip: "8.8.8.8",
						cached: false,
						normalized: { country: "US", countryIso2: "US", isp: null, asn: null },
						raw: { country: "US" },
						rawTruncated: false,
						fetchedAt: 1_700_000_000,
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		),
	);
	globalThis.fetch = mockFetchFn as never;
	mockAuth.mockResolvedValue({ user: { email: "alice@example.com", name: "Alice" } });
	mockResolveAdmin.mockReturnValue({ sub: "1", email: "alice@example.com", name: "Alice" });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
	if (originalEnv.IP_LOOKUP_API_KEY === undefined) {
		Reflect.deleteProperty(process.env, "IP_LOOKUP_API_KEY");
	} else {
		process.env.IP_LOOKUP_API_KEY = originalEnv.IP_LOOKUP_API_KEY;
	}
});

function makeReq(qs: string, ip = "203.0.113.5"): Request {
	return new Request(`http://localhost/api/admin/ip-lookup${qs}`, {
		method: "GET",
		headers: {
			origin: "http://localhost:3000",
			"x-forwarded-for": ip,
		},
	}) as never;
}

describe("admin ip-lookup BFF proxy — G.6.2", () => {
	it("forwards ?ip query to worker and returns envelope verbatim", async () => {
		const res = await GET(makeReq("?ip=8.8.8.8"), { params: Promise.resolve({}) });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { ip: string; cached: boolean } };
		expect(body.data.ip).toBe("8.8.8.8");
		expect(body.data.cached).toBe(false);

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/admin/ip-lookup?ip=8.8.8.8");
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-API-Key"]).toBe("test-key");
		// GET → no actor headers expected (adminApiAs skips them on GET).
		expect(headers["X-Admin-Actor-Email"]).toBeUndefined();
		expect(headers["X-Admin-Actor-Name"]).toBeUndefined();
	});

	it("does not read or forward IP_LOOKUP_API_KEY in URL/headers/body", async () => {
		await GET(makeReq("?ip=1.1.1.1"), { params: Promise.resolve({}) });
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headersJson = JSON.stringify(opts.headers ?? {});
		const bodyStr = typeof opts.body === "string" ? opts.body : "";
		expect(url).not.toContain(SECRET_SENTINEL);
		expect(headersJson).not.toContain(SECRET_SENTINEL);
		expect(headersJson).not.toContain("IP_LOOKUP_API_KEY");
		expect(headersJson).not.toContain("X-Api-Key");
		expect(bodyStr).not.toContain(SECRET_SENTINEL);
	});

	it("propagates worker error envelope and status", async () => {
		mockFetchFn.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ error: { code: "INVALID_IP", details: { reason: "missing" } } }),
				{
					status: 400,
					headers: { "Content-Type": "application/json" },
				},
			),
		);
		const res = await GET(makeReq(""), { params: Promise.resolve({}) });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { reason: string } } };
		expect(body.error.code).toBe("INVALID_IP");
		expect(body.error.details?.reason).toBe("missing");
	});

	it("forwards client IP via X-Real-IP", async () => {
		await GET(makeReq("?ip=8.8.8.8", "198.51.100.7"), { params: Promise.resolve({}) });
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Ellie-Client-IP"]).toBe("198.51.100.7");
	});
});
