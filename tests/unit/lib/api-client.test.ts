import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../apps/web/src/lib/api-client";

// ---------------------------------------------------------------------------
// Setup: mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

let mockFetchFn: ReturnType<typeof vi.fn>;

function mockSuccess(data: unknown) {
	mockFetchFn = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify({ data, meta: { timestamp: 1, requestId: "r1" } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as typeof fetch;
}

beforeEach(() => {
	mockSuccess({ ok: true });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("apiClient", () => {
	describe("put", () => {
		it("should send PUT request with JSON body", async () => {
			const body = { "general.site.name": "New Name" };
			await apiClient.put("/api/admin/settings", body);

			expect(mockFetchFn).toHaveBeenCalledTimes(1);
			const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("/api/admin/settings");
			expect(opts.method).toBe("PUT");
			expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
			expect(opts.body).toBe(JSON.stringify(body));
		});

		it("should return parsed data and meta", async () => {
			mockSuccess({ updated: 3 });
			const result = await apiClient.put<{ updated: number }>("/api/admin/settings", {});

			expect(result.data.updated).toBe(3);
			expect(result.meta.requestId).toBe("r1");
		});

		it("should throw ApiError on non-ok response", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({ error: { code: "UNKNOWN_KEYS", message: "Unknown key" } }),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;

			await expect(apiClient.put("/api/admin/settings", { "bad.key": "v" })).rejects.toThrow();
		});
	});

	describe("get", () => {
		it("should send GET request", async () => {
			await apiClient.get("/api/admin/settings");

			expect(mockFetchFn).toHaveBeenCalledTimes(1);
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("GET");
		});

		it("should pass search params", async () => {
			await apiClient.get("/api/admin/settings", { prefix: "general.site" });

			const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("prefix=general.site");
		});
	});

	describe("post", () => {
		it("should send POST request with body", async () => {
			await apiClient.post("/api/admin/ip-bans", { ip: "1.2.3.4" });

			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("POST");
			expect(opts.body).toBe(JSON.stringify({ ip: "1.2.3.4" }));
		});
	});

	describe("patch", () => {
		it("should send PATCH request with body", async () => {
			await apiClient.patch("/api/admin/users/1", { role: 1 });

			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("PATCH");
		});
	});

	describe("delete", () => {
		it("should send DELETE request", async () => {
			await apiClient.delete("/api/admin/users/1");

			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("DELETE");
		});
	});
});
