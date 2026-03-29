import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { AdminApiError, adminApi } from "../../../apps/web/src/lib/admin-api";

// ---------------------------------------------------------------------------
// Setup: mock fetch + env vars
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

let mockFetchFn: ReturnType<typeof mock>;

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.ADMIN_API_KEY = "test-key-b";
	mockFetchFn = mock(() =>
		Promise.resolve(
			new Response(
				JSON.stringify({ data: { ok: true }, meta: { timestamp: 1, requestId: "r1" } }),
				{
					status: 200,
					headers: { "Content-Type": "application/json" },
				},
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

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

describe("adminApi request construction", () => {
	it("sends GET with X-API-Key header", async () => {
		await adminApi.get("/api/admin/stats");

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/admin/stats");
		expect(opts.method).toBe("GET");
		expect((opts.headers as Record<string, string>)["X-API-Key"]).toBe("test-key-b");
		expect(opts.body).toBeUndefined();
	});

	it("sends POST with JSON body", async () => {
		await adminApi.post("/api/admin/users/1/ban", { reason: "spam" });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.method).toBe("POST");
		expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
		expect(opts.body).toBe(JSON.stringify({ reason: "spam" }));
	});

	it("sends PATCH with JSON body", async () => {
		await adminApi.patch("/api/admin/users/1", { name: "New Name" });

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.method).toBe("PATCH");
		expect(opts.body).toBe(JSON.stringify({ name: "New Name" }));
	});

	it("sends DELETE without body", async () => {
		await adminApi.delete("/api/admin/forums/1");

		const [, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(opts.method).toBe("DELETE");
		expect(opts.body).toBeUndefined();
	});

	it("appends search params to URL", async () => {
		await adminApi.get("/api/admin/users", { page: 2, limit: 20, search: "test" });

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("page")).toBe("2");
		expect(parsed.searchParams.get("limit")).toBe("20");
		expect(parsed.searchParams.get("search")).toBe("test");
	});

	it("skips null/undefined/empty search params", async () => {
		await adminApi.get("/api/admin/users", { page: 1, search: undefined, filter: null, empty: "" });

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		const parsed = new URL(url);
		expect(parsed.searchParams.get("page")).toBe("1");
		expect(parsed.searchParams.has("search")).toBe(false);
		expect(parsed.searchParams.has("filter")).toBe(false);
		expect(parsed.searchParams.has("empty")).toBe(false);
	});

	it("strips trailing slashes from WORKER_API_URL", async () => {
		process.env.WORKER_API_URL = "https://worker.example.com///";
		await adminApi.get("/api/admin/stats");

		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.example.com/api/admin/stats");
	});
});

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

describe("adminApi response parsing", () => {
	it("parses { data, meta } envelope from get()", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({ data: { count: 42 }, meta: { timestamp: 123, requestId: "abc" } }),
					{ status: 200 },
				),
			),
		);

		const result = await adminApi.get<{ count: number }>("/api/admin/stats");
		expect(result.data).toEqual({ count: 42 });
		expect(result.meta.timestamp).toBe(123);
		expect(result.meta.requestId).toBe("abc");
	});

	it("parses paginated list from getList()", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						data: [{ id: 1 }, { id: 2 }],
						meta: { timestamp: 1, requestId: "r1", total: 50, page: 1, limit: 20, pages: 3 },
					}),
					{ status: 200 },
				),
			),
		);

		const result = await adminApi.getList<{ id: number }>("/api/admin/users");
		expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
		expect(result.meta.total).toBe(50);
		expect(result.meta.page).toBe(1);
		expect(result.meta.pages).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("adminApi error handling", () => {
	it("throws AdminApiError on 4xx with error body", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "User not found" } }), {
					status: 404,
				}),
			),
		);

		try {
			await adminApi.get("/api/admin/users/999");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AdminApiError);
			const err = e as AdminApiError;
			expect(err.status).toBe(404);
			expect(err.code).toBe("NOT_FOUND");
			expect(err.message).toBe("User not found");
		}
	});

	it("throws AdminApiError on 5xx without error body", async () => {
		mockFetchFn.mockImplementation(() => Promise.resolve(new Response("", { status: 500 })));

		try {
			await adminApi.get("/api/admin/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AdminApiError);
			const err = e as AdminApiError;
			expect(err.status).toBe(500);
			expect(err.code).toBe("UNKNOWN");
		}
	});

	it("throws AdminApiError when response is not valid JSON", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(new Response("not json", { status: 200 })),
		);

		try {
			await adminApi.get("/api/admin/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toBeInstanceOf(AdminApiError);
			const err = e as AdminApiError;
			expect(err.code).toBe("PARSE_ERROR");
		}
	});

	it("includes details from error response", async () => {
		mockFetchFn.mockImplementation(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						error: { code: "INVALID_BODY", message: "Bad request", details: { field: "email" } },
					}),
					{ status: 400 },
				),
			),
		);

		try {
			await adminApi.patch("/api/admin/users/1", {});
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as AdminApiError;
			expect(err.details).toEqual({ field: "email" });
		}
	});
});

// ---------------------------------------------------------------------------
// Environment variable validation
// ---------------------------------------------------------------------------

describe("adminApi environment validation", () => {
	it("throws when WORKER_API_URL is not set", async () => {
		process.env.WORKER_API_URL = undefined;

		try {
			await adminApi.get("/api/admin/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain("WORKER_API_URL");
		}
	});

	it("throws when ADMIN_API_KEY is not set", async () => {
		process.env.ADMIN_API_KEY = undefined;

		try {
			await adminApi.get("/api/admin/stats");
			expect.unreachable("should have thrown");
		} catch (e) {
			expect((e as Error).message).toContain("ADMIN_API_KEY");
		}
	});
});
