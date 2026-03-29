import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { adminApi } from "../../../apps/web/src/lib/admin-api";
import { passthrough } from "../../../apps/web/src/lib/admin-proxy";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

let mockFetchFn: ReturnType<typeof mock>;

function mockJsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.ADMIN_API_KEY = "test-key-b";

	mockFetchFn = mock(() =>
		Promise.resolve(
			mockJsonResponse({
				data: [{ id: 1, username: "alice" }],
				meta: { timestamp: 1711612800000, requestId: "r1", total: 1, page: 1, limit: 20, pages: 1 },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
});

describe("users api proxy", () => {
	it("GET /api/admin/users forwards with search params", async () => {
		const res = await adminApi.raw("GET", "/api/admin/users?page=2&limit=20&username=alice");
		const proxied = await passthrough(res);

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users?page=2&limit=20&username=alice");
		expect(opts.method).toBe("GET");
		expect(proxied.status).toBe(200);
	});

	it("GET /api/admin/users/:id forwards correctly", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				mockJsonResponse({
					data: { id: 42, username: "bob" },
					meta: { timestamp: 1711612800000, requestId: "r2" },
				}),
			),
		);

		const res = await adminApi.raw("GET", "/api/admin/users/42");
		const proxied = await passthrough(res);

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42");
		expect(proxied.status).toBe(200);
		const body = await proxied.json();
		expect(body.data.id).toBe(42);
	});

	it("PATCH /api/admin/users/:id sends body", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { id: 42, role: 1 }, meta: {} })),
		);

		const res = await adminApi.raw("PATCH", "/api/admin/users/42", { role: 1 });
		const proxied = await passthrough(res);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42");
		expect(opts.method).toBe("PATCH");
		expect(opts.body).toBe(JSON.stringify({ role: 1 }));
		expect(proxied.status).toBe(200);
	});

	it("POST /api/admin/users/:id/ban forwards ban request", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { banned: true }, meta: {} })),
		);

		const res = await adminApi.raw("POST", "/api/admin/users/42/ban", { deleteContent: true });
		const proxied = await passthrough(res);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/ban");
		expect(opts.method).toBe("POST");
		expect(opts.body).toBe(JSON.stringify({ deleteContent: true }));
		expect(proxied.status).toBe(200);
	});

	it("POST /api/admin/users/:id/nuke forwards nuke request", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { nuked: true }, meta: {} })),
		);

		const res = await adminApi.raw("POST", "/api/admin/users/42/nuke");
		const proxied = await passthrough(res);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/nuke");
		expect(opts.method).toBe("POST");
		expect(proxied.status).toBe(200);
	});

	it("POST /api/admin/users/batch-status sends ids and status", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 3 }, meta: {} })),
		);

		const body = { ids: [1, 2, 3], status: -1 };
		const res = await adminApi.raw("POST", "/api/admin/users/batch-status", body);
		const proxied = await passthrough(res);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/batch-status");
		expect(opts.body).toBe(JSON.stringify(body));
		expect(proxied.status).toBe(200);
	});

	it("POST /api/admin/users/batch-role sends ids and role", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(mockJsonResponse({ data: { affected: 2 }, meta: {} })),
		);

		const body = { ids: [10, 20], role: 3 };
		const res = await adminApi.raw("POST", "/api/admin/users/batch-role", body);
		const proxied = await passthrough(res);

		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/batch-role");
		expect(opts.body).toBe(JSON.stringify(body));
		expect(proxied.status).toBe(200);
	});
});
