import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AdminApiError, adminApi } from "@/lib/admin-api";

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
