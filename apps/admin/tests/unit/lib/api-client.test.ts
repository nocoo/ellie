import { ApiError, apiClient } from "@/lib/api-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = globalThis.fetch;
let mockFetchFn: ReturnType<typeof vi.fn>;

function mockSuccess(data: unknown, meta?: any) {
	mockFetchFn = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify({ data, meta: meta ?? { timestamp: 1, requestId: "r1" } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as any;
}

beforeEach(() => {
	mockSuccess({ ok: true });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("apiClient", () => {
	describe("get", () => {
		it("sends GET request", async () => {
			await apiClient.get("/api/admin/settings");
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("GET");
		});

		it("passes search params", async () => {
			await apiClient.get("/api/admin/settings", { prefix: "general" });
			const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).toContain("prefix=general");
		});

		it("omits null/undefined/empty params", async () => {
			await apiClient.get("/api/admin/settings", { a: null, b: undefined, c: "" });
			const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(url).not.toContain("a=");
			expect(url).not.toContain("b=");
			expect(url).not.toContain("c=");
		});
	});

	describe("getList", () => {
		it("returns paginated data", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							data: [{ id: 1 }],
							meta: { timestamp: 1, requestId: "r1", page: 1, pages: 3, total: 50, limit: 20 },
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
				),
			);
			globalThis.fetch = mockFetchFn as any;

			const result = await apiClient.getList<{ id: number }>("/api/admin/users");
			expect(result.data).toHaveLength(1);
			expect(result.meta.page).toBe(1);
			expect(result.meta.pages).toBe(3);
		});
	});

	describe("post", () => {
		it("sends POST with body", async () => {
			await apiClient.post("/api/admin/ip-bans", { ip: "1.2.3.4" });
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("POST");
			expect(opts.body).toBe(JSON.stringify({ ip: "1.2.3.4" }));
			expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
		});
	});

	describe("patch", () => {
		it("sends PATCH request", async () => {
			await apiClient.patch("/api/admin/users/1", { role: 1 });
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("PATCH");
		});
	});

	describe("put", () => {
		it("sends PUT request with body", async () => {
			const body = { "general.site.name": "X" };
			await apiClient.put("/api/admin/settings", body);
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("PUT");
			expect(opts.body).toBe(JSON.stringify(body));
		});
	});

	describe("delete", () => {
		it("sends DELETE request", async () => {
			await apiClient.delete("/api/admin/users/1");
			const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
			expect(opts.method).toBe("DELETE");
		});
	});

	describe("error handling", () => {
		it("throws ApiError on non-ok response", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), {
						status: 404,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as any;

			await expect(apiClient.get("/api/admin/nope")).rejects.toThrow();
		});

		it("throws on invalid JSON", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response("not json", { status: 200, headers: { "Content-Type": "text/plain" } }),
				),
			);
			globalThis.fetch = mockFetchFn as any;

			await expect(apiClient.get("/api/admin/bad")).rejects.toThrow("Failed to parse");
		});

		it("preserves error.details from worker envelope", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							error: {
								code: "VALIDATION_FAILED",
								message: "Validation failed",
								details: { fields: { username: "USERNAME_TAKEN" } },
							},
						}),
						{ status: 400, headers: { "Content-Type": "application/json" } },
					),
				),
			);
			globalThis.fetch = mockFetchFn as any;

			let caught: unknown;
			try {
				await apiClient.patch("/api/admin/users/1", { username: "admin" });
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(ApiError);
			const err = caught as ApiError;
			expect(err.status).toBe(400);
			expect(err.code).toBe("VALIDATION_FAILED");
			expect(err.message).toBe("Validation failed");
			expect(err.details).toEqual({ fields: { username: "USERNAME_TAKEN" } });
		});

		it("leaves details undefined when worker omits it", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Not found" } }), {
						status: 404,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as any;

			let caught: unknown;
			try {
				await apiClient.get("/api/admin/missing");
			} catch (err) {
				caught = err;
			}
			expect(caught).toBeInstanceOf(ApiError);
			expect((caught as ApiError).details).toBeUndefined();
		});
	});
});
