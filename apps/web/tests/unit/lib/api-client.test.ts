import { ApiError, apiClient } from "@/lib/api-client";
import { EMAIL_NOT_VERIFIED_EVENT } from "@/viewmodels/forum/email-not-verified-dispatch";
import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

	describe("getList", () => {
		it("should send GET request and return paginated data", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							data: [{ id: 1 }, { id: 2 }],
							meta: { timestamp: 1, requestId: "r1", page: 1, pages: 3, total: 50 },
						}),
						{ status: 200, headers: { "Content-Type": "application/json" } },
					),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;

			const result = await apiClient.getList<{ id: number }>("/api/admin/users", { page: "1" });

			expect(result.data).toHaveLength(2);
			expect(result.meta.page).toBe(1);
			expect(result.meta.pages).toBe(3);
		});
	});

	describe("error handling", () => {
		it("should throw ApiError with PARSE_ERROR when response is invalid JSON", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response("not json at all {{{", {
						status: 200,
						headers: { "Content-Type": "text/plain" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;

			await expect(apiClient.get("/api/v1/forums")).rejects.toThrow("Failed to parse response");
		});

		it("should preserve rawBody on ApiError for non-OK responses", async () => {
			// Phase 7-1: callers (e.g. the verification dialog) need the raw
			// body so they can render the Worker's copy without a second fetch.
			const body = { error: { code: "X", message: "y" }, hint: "extra" };
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify(body), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;
			try {
				await apiClient.get("/api/v1/forums");
				expect.fail("expected throw");
			} catch (e) {
				expect(e).toBeInstanceOf(ApiError);
				expect((e as ApiError).rawBody).toEqual(body);
			}
		});
	});

	describe("EMAIL_NOT_VERIFIED dispatch (docs/17 §5.4)", () => {
		// The api-client must detect the flat §5.4 payload on any non-OK
		// response and dispatch the global dialog event. Reviewer's
		// directive (msg 0e069f5b): "全局/共享 fetch 能识别 Worker 的 flat
		// EMAIL_NOT_VERIFIED payload".
		const originalDispatchEvent = globalThis.dispatchEvent;
		let dispatchSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			dispatchSpy = vi.fn();
			// The viewmodel's `dispatchEmailNotVerified` reads `window`. In the
			// node test env we stub a minimal window with dispatchEvent. We
			// also need `location.origin` because the api-client's getBaseUrl
			// reads it when window is defined.
			(globalThis as { window?: unknown }).window = {
				dispatchEvent: dispatchSpy,
				location: { origin: "http://localhost" },
			};
		});

		afterEach(() => {
			(globalThis as { window?: unknown }).window = undefined;
			globalThis.dispatchEvent = originalDispatchEvent;
		});

		it("dispatches the email-not-verified event when the body matches §5.4", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ ...EMAIL_NOT_VERIFIED_PAYLOAD }), {
						status: 403,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;

			try {
				await apiClient.post("/api/v1/threads", { title: "x" });
				expect.fail("expected throw");
			} catch (e) {
				expect(e).toBeInstanceOf(ApiError);
				expect((e as ApiError).code).toBe("EMAIL_NOT_VERIFIED");
				expect((e as ApiError).rawBody).toEqual({ ...EMAIL_NOT_VERIFIED_PAYLOAD });
			}

			expect(dispatchSpy).toHaveBeenCalledTimes(1);
			const evt = dispatchSpy.mock.calls[0][0] as CustomEvent;
			expect(evt.type).toBe(EMAIL_NOT_VERIFIED_EVENT);
			expect(evt.detail.redirect_to).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.redirect_to);
			expect(evt.detail.dialog.title).toBe(EMAIL_NOT_VERIFIED_PAYLOAD.dialog.title);
		});

		it("does NOT dispatch for the wrapped { error: { code } } shape", async () => {
			// Even if the wrapped envelope happens to carry code
			// "EMAIL_NOT_VERIFIED", the §5.4 dialog must not fire — the dialog
			// requires the flat shape so it can render the dialog body.
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: "EMAIL_NOT_VERIFIED", message: "x" } }), {
						status: 403,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;

			await expect(apiClient.post("/api/v1/threads", { title: "x" })).rejects.toThrow();
			expect(dispatchSpy).not.toHaveBeenCalled();
		});

		it("does NOT dispatch for unrelated 4xx errors", async () => {
			mockFetchFn = vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: { code: "BAD_REQUEST", message: "x" } }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					}),
				),
			);
			globalThis.fetch = mockFetchFn as typeof fetch;

			await expect(apiClient.post("/api/v1/threads", { title: "x" })).rejects.toThrow();
			expect(dispatchSpy).not.toHaveBeenCalled();
		});
	});
});
