import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AdminApiError, adminApi, adminApiAs } from "@/lib/admin-api";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let mockFetchFn: ReturnType<typeof vi.fn>;

function mockResponse(status: number, body: unknown) {
	mockFetchFn = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as any;
}

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com/";
	process.env.ADMIN_API_KEY = "test-key-123";
	mockResponse(200, { data: { ok: true }, meta: { timestamp: 1, requestId: "r1" } });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
});

describe("adminApi", () => {
	describe("get", () => {
		it("sends GET with X-API-Key", async () => {
			await adminApi.get("/api/admin/stats");
			const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("worker.example.com");
			expect(url).toContain("/api/admin/stats");
			expect(opts.method).toBe("GET");
			expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe("test-key-123");
		});

		it("passes search params", async () => {
			await adminApi.get("/api/admin/settings", { prefix: "general" });
			const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("prefix=general");
		});

		it("strips trailing slashes from worker URL", async () => {
			process.env.WORKER_API_URL = "https://worker.example.com///";
			await adminApi.get("/api/test");
			const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).not.toContain("///");
		});
	});

	describe("getList", () => {
		it("returns paginated response", async () => {
			mockResponse(200, {
				data: [{ id: 1 }],
				meta: { timestamp: 1, requestId: "r1", total: 50, page: 1, limit: 20, pages: 3 },
			});
			const result = await adminApi.getList<{ id: number }>("/api/admin/users");
			expect(result.data).toHaveLength(1);
			expect(result.meta.total).toBe(50);
		});
	});

	describe("post", () => {
		it("sends POST with JSON body and API key", async () => {
			await adminApi.post("/api/admin/bans", { ip: "1.2.3.4" });
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("POST");
			expect(opts.body).toBe(JSON.stringify({ ip: "1.2.3.4" }));
			expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
		});
	});

	describe("patch", () => {
		it("sends PATCH request", async () => {
			await adminApi.patch("/api/admin/users/1", { role: 1 });
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("PATCH");
		});
	});

	describe("delete", () => {
		it("sends DELETE request", async () => {
			await adminApi.delete("/api/admin/users/1");
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("DELETE");
		});
	});

	describe("raw", () => {
		it("returns raw Response", async () => {
			const res = await adminApi.raw("GET", "/api/admin/export");
			expect(res).toBeInstanceOf(Response);
		});

		it("includes API key in raw requests", async () => {
			await adminApi.raw("POST", "/api/admin/import", { data: "x" });
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe("test-key-123");
			expect(opts.body).toBe(JSON.stringify({ data: "x" }));
		});
	});

	describe("error handling", () => {
		it("throws AdminApiError on non-ok response", async () => {
			mockResponse(400, { error: { code: "BAD_REQUEST", message: "Invalid" } });
			await expect(adminApi.get("/api/fail")).rejects.toThrow(AdminApiError);
		});

		it("throws AdminApiError on parse failure", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } }),
				),
			);
			globalThis.fetch = mockFetchFn as any;
			await expect(adminApi.get("/api/bad")).rejects.toThrow("Failed to parse");
		});

		it("throws when WORKER_API_URL is not set", async () => {
			process.env.WORKER_API_URL = "";
			await expect(adminApi.get("/api/x")).rejects.toThrow("WORKER_API_URL");
		});

		it("throws when ADMIN_API_KEY is not set", async () => {
			process.env.ADMIN_API_KEY = "";
			await expect(adminApi.get("/api/x")).rejects.toThrow("ADMIN_API_KEY");
		});
	});
});

// ─── adminApiAs (F1: actor-bound client) ─────────────────────────

describe("adminApiAs", () => {
	const actor = { email: "alice@example.com", name: "Alice" };

	it("injects X-Admin-Actor headers on POST", async () => {
		const api = adminApiAs(actor);
		await api.raw("POST", "/api/admin/users/1/ban", { reason: "spam" });
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBe("alice@example.com");
		expect(headers["X-Admin-Actor-Name"]).toBe("Alice");
		expect(headers["X-API-Key"]).toBe("test-key-123");
	});

	it.each(["PATCH", "PUT", "DELETE"])("injects actor headers on %s", async (method) => {
		const api = adminApiAs(actor);
		await api.raw(method, "/api/admin/x");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBe("alice@example.com");
		expect(headers["X-Admin-Actor-Name"]).toBe("Alice");
	});

	it("does NOT inject actor headers on GET", async () => {
		const api = adminApiAs(actor);
		await api.raw("GET", "/api/admin/users");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBeUndefined();
		expect(headers["X-Admin-Actor-Name"]).toBeUndefined();
	});

	it("does NOT inject actor headers on HEAD", async () => {
		const api = adminApiAs(actor);
		await api.raw("HEAD", "/api/admin/users");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBeUndefined();
	});

	it("is case-insensitive on the method", async () => {
		const api = adminApiAs(actor);
		await api.raw("post", "/api/admin/x");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBe("alice@example.com");
	});

	it("merges with caller-supplied extraHeaders without losing actor headers", async () => {
		const api = adminApiAs(actor);
		await api.raw("POST", "/api/admin/x", { a: 1 }, { "X-Custom": "yes" });
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Custom"]).toBe("yes");
		expect(headers["X-Admin-Actor-Email"]).toBe("alice@example.com");
	});

	it("respects caller override of actor headers", async () => {
		const api = adminApiAs(actor);
		await api.raw("POST", "/api/admin/x", null, { "X-Admin-Actor-Email": "override@example.com" });
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBe("override@example.com");
		// Name still comes from actor since caller did not override.
		expect(headers["X-Admin-Actor-Name"]).toBe("Alice");
	});

	// ─── G.2: X-Real-IP propagation when bound to a request ───────────

	function reqWithHeaders(headers: Record<string, string>): Request {
		return new Request("https://admin.example.com/api/admin/x", { headers });
	}

	it("forwards X-Real-IP from CF-Connecting-IP on mutations", async () => {
		const req = reqWithHeaders({ "CF-Connecting-IP": "203.0.113.7" });
		const api = adminApiAs(actor, req);
		await api.raw("POST", "/api/admin/users/1/ban");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Real-IP"]).toBe("203.0.113.7");
	});

	it("forwards X-Real-IP on GET (read-only path) too", async () => {
		const req = reqWithHeaders({ "CF-Connecting-IP": "203.0.113.8" });
		const api = adminApiAs(actor, req);
		await api.raw("GET", "/api/admin/users/1");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Real-IP"]).toBe("203.0.113.8");
		// GET still must not carry actor identity headers.
		expect(headers["X-Admin-Actor-Email"]).toBeUndefined();
	});

	it("falls back to X-Forwarded-For first segment when CF header missing (non-prod)", async () => {
		const prevNodeEnv = process.env.NODE_ENV;
		(process.env as Record<string, string | undefined>).NODE_ENV = "test";
		try {
			const req = reqWithHeaders({ "X-Forwarded-For": "198.51.100.5, 10.0.0.1" });
			const api = adminApiAs(actor, req);
			await api.raw("PATCH", "/api/admin/users/1");
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect((opts.headers as Record<string, string>)["X-Real-IP"]).toBe("198.51.100.5");
		} finally {
			(process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
		}
	});

	it("does NOT inject X-Real-IP from XFF in production (anti-spoof)", async () => {
		const prevNodeEnv = process.env.NODE_ENV;
		(process.env as Record<string, string | undefined>).NODE_ENV = "production";
		try {
			const req = reqWithHeaders({ "X-Forwarded-For": "198.51.100.5, 10.0.0.1" });
			const api = adminApiAs(actor, req);
			await api.raw("POST", "/api/admin/users/1/ban");
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect((opts.headers as Record<string, string>)["X-Real-IP"]).toBeUndefined();
		} finally {
			(process.env as Record<string, string | undefined>).NODE_ENV = prevNodeEnv;
		}
	});

	it("omits X-Real-IP when no IP header is present", async () => {
		const req = reqWithHeaders({});
		const api = adminApiAs(actor, req);
		await api.raw("POST", "/api/admin/x");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>)["X-Real-IP"]).toBeUndefined();
	});

	it("omits X-Real-IP when no request is bound", async () => {
		const api = adminApiAs(actor);
		await api.raw("POST", "/api/admin/x");
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>)["X-Real-IP"]).toBeUndefined();
	});

	it("respects caller override of X-Real-IP", async () => {
		const req = reqWithHeaders({ "CF-Connecting-IP": "203.0.113.7" });
		const api = adminApiAs(actor, req);
		await api.raw("POST", "/api/admin/x", null, { "X-Real-IP": "127.0.0.1" });
		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect((opts.headers as Record<string, string>)["X-Real-IP"]).toBe("127.0.0.1");
	});
});
