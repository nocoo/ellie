import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Stats API route test — verifies proxy forwarding pattern
//
// Since the route handler is wrapped by createProxyHandler (which calls
// next-auth's auth()), we test the pattern indirectly:
// 1. The raw proxy call constructs the correct URL
// 2. The passthrough function preserves status + body
// ---------------------------------------------------------------------------

import { adminApi } from "../../../apps/web/src/lib/admin-api";
import { passthrough } from "../../../apps/web/src/lib/admin-proxy";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

let mockFetchFn: ReturnType<typeof mock>;

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.ADMIN_API_KEY = "test-key-b";

	mockFetchFn = mock(() =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					data: {
						users: { total: 100, today: 5, banned: 2 },
						threads: { total: 500, today: 10 },
						posts: { total: 3000, today: 50 },
						forums: { total: 20, hidden: 1 },
					},
					meta: { timestamp: 1711612800000, requestId: "r1" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
});

describe("stats api proxy", () => {
	it("forwards GET /api/admin/stats to Worker with correct URL and headers", async () => {
		const res = await adminApi.raw("GET", "/api/admin/stats");

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/admin/stats");
		expect(opts.method).toBe("GET");
		expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe("test-key-b");

		// passthrough preserves response
		const proxied = await passthrough(res);
		expect(proxied.status).toBe(200);

		const body = await proxied.json();
		expect(body.data.users.total).toBe(100);
		expect(body.data.threads.today).toBe(10);
		expect(body.data.forums.hidden).toBe(1);
	});

	it("passthrough preserves error status from Worker", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } }),
					{ status: 401, headers: { "Content-Type": "application/json" } },
				),
			),
		);

		const res = await adminApi.raw("GET", "/api/admin/stats");
		const proxied = await passthrough(res);
		expect(proxied.status).toBe(401);

		const body = await proxied.json();
		expect(body.error.code).toBe("UNAUTHORIZED");
	});
});
