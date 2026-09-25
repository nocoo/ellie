// BFF route test for /api/admin/memory-cache (docs/29 memory management).
//
// Verifies the admin proxy contract: configured-origin-only upstream call
// with X-Ellie-Memory-Key, strict query/body validation via the frozen
// shared parser, bounded/typed upstream mapping (data envelope, known error
// codes with contract status, anything else → 502), no-store on every
// response, config-missing fail-closed, and that the management key never
// appears in any response.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin", () => ({ resolveAdmin: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
	validateOrigin: vi.fn(() => true),
	getAllowedOrigins: vi.fn(() => ["http://localhost:7032"]),
}));

import { GET, POST } from "@/app/api/admin/memory-cache/route";
import { auth } from "@/auth";
import { resolveAdmin } from "@/lib/admin";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockResolveAdmin = resolveAdmin as ReturnType<typeof vi.fn>;

const UPSTREAM_BASE = "http://web.internal:3000";
const ADMIN_KEY = "unit-memory-admin-key";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let mockFetchFn: ReturnType<typeof vi.fn>;

function upstreamJson(status: number, body: unknown, headers: Record<string, string> = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

const OVERVIEW_DATA = {
	instance: {
		id: "web-1",
		version: "1.14.1",
		startedAt: "2026-09-23T09:00:00.000Z",
		uptimeMs: 120_000,
	},
	memory: { rssBytes: 1, heapUsedBytes: 1, estimatedPayloadBytes: 1, payloadLimitBytes: 8_388_608 },
	families: [
		{
			id: "forum-read",
			entries: 1,
			maxEntries: 1,
			hits: 2,
			misses: 1,
			evictions: 0,
			loadErrors: 0,
		},
	],
	entries: [
		{
			family: "forum-read",
			key: "site:1",
			createdAt: "2026-09-23T09:01:00.000Z",
			expiresAt: "2026-09-23T09:06:00.000Z",
			estimatedBytes: 32,
			preview: '{"threads":10}',
		},
	],
	pagination: { page: 1, limit: 50, total: 1 },
	buffers: {
		pendingThreads: 1,
		pendingViews: 2,
		pendingUsers: 3,
		oldestPendingAt: null,
		flushing: false,
		lastFlushAt: null,
		lastSuccessAt: null,
		unconfirmedViews: 0,
		droppedViews: 0,
		droppedActivities: 0,
	},
	history: [{ at: "2026-09-23T09:01:00.000Z", estimatedPayloadBytes: 1, pendingViews: 2 }],
};

beforeEach(() => {
	process.env.WEB_MEMORY_ADMIN_URL = UPSTREAM_BASE;
	process.env.MEMORY_CACHE_ADMIN_KEY = ADMIN_KEY;
	mockFetchFn = vi.fn(() => Promise.resolve(upstreamJson(200, { data: OVERVIEW_DATA })));
	globalThis.fetch = mockFetchFn as never;
	mockAuth.mockResolvedValue({ user: { email: "alice@example.com", name: "Alice" } });
	mockResolveAdmin.mockReturnValue({ sub: "1", email: "alice@example.com", name: "Alice" });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const key of ["WEB_MEMORY_ADMIN_URL", "MEMORY_CACHE_ADMIN_KEY"]) {
		if (originalEnv[key] === undefined) Reflect.deleteProperty(process.env, key);
		else process.env[key] = originalEnv[key];
	}
});

function makeGet(qs: string): Request {
	return new Request(`http://localhost:7032/api/admin/memory-cache${qs}`, {
		method: "GET",
	}) as never;
}

function makePost(body: string): Request {
	return new Request("http://localhost:7032/api/admin/memory-cache", {
		method: "POST",
		headers: { "Content-Type": "application/json", origin: "http://localhost:7032" },
		body,
	}) as never;
}

const ctx = { params: Promise.resolve({}) } as never;

describe("GET /api/admin/memory-cache", () => {
	it("never reflects an upstream error message containing the management secret", async () => {
		mockFetchFn.mockResolvedValueOnce(
			upstreamJson(400, { error: { code: "BAD_REQUEST", message: `Invalid header ${ADMIN_KEY}` } }),
		);
		const response = await GET(makeGet(""), ctx);
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).not.toContain(ADMIN_KEY);
		expect(JSON.parse(text).error.message).toBe("Invalid request body");
	});

	it("forwards validated query to the configured Web origin with the management key only", async () => {
		const res = await GET(makeGet("?family=forum-summary&page=2&limit=100"), ctx);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		const body = (await res.json()) as { data: typeof OVERVIEW_DATA };
		expect(body.data.instance.id).toBe("web-1");

		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [URL, RequestInit];
		expect(url.origin).toBe(UPSTREAM_BASE);
		expect(url.pathname).toBe("/api/internal/memory-cache");
		expect(url.searchParams.get("family")).toBe("forum-summary");
		expect(url.searchParams.get("page")).toBe("2");
		expect(url.searchParams.get("limit")).toBe("100");
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Ellie-Memory-Key"]).toBe(ADMIN_KEY);
		// No browser headers/credentials are forwarded.
		expect(headers.Authorization).toBeUndefined();
		expect(headers.Cookie).toBeUndefined();
		expect(opts.redirect).toBe("error");
		expect(res.headers.get("Location")).toBeNull();
	});

	it("rejects unknown or invalid query parameters with BAD_REQUEST 400", async () => {
		for (const qs of ["?evil=1", "?family=nope", "?page=0", "?limit=101", "?page=1&page=2"]) {
			const res = await GET(makeGet(qs), ctx);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("BAD_REQUEST");
			expect(res.headers.get("Cache-Control")).toBe("no-store");
		}
		expect(mockFetchFn).not.toHaveBeenCalled();
	});

	it("fails closed with 503 NOT_CONFIGURED (and no upstream call) when env is missing", async () => {
		Reflect.deleteProperty(process.env, "WEB_MEMORY_ADMIN_URL");
		const res = await GET(makeGet(""), ctx);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("NOT_CONFIGURED");
		expect(mockFetchFn).not.toHaveBeenCalled();

		Reflect.deleteProperty(process.env, "MEMORY_CACHE_ADMIN_KEY");
		process.env.WEB_MEMORY_ADMIN_URL = UPSTREAM_BASE;
		const res2 = await GET(makeGet(""), ctx);
		expect(res2.status).toBe(503);
		expect(mockFetchFn).not.toHaveBeenCalled();
	});

	it("rejects a non-http(s) or malformed configured origin as NOT_CONFIGURED", async () => {
		for (const bad of [
			"javascript:alert(1)",
			"http://user:pass@web.internal:3000",
			"not a url",
			"http://web.internal:3000/prefix",
			"http://web.internal:3000?key=1",
		]) {
			process.env.WEB_MEMORY_ADMIN_URL = bad;
			const res = await GET(makeGet(""), ctx);
			expect(res.status).toBe(503);
		}
		expect(mockFetchFn).not.toHaveBeenCalled();
	});

	it("maps a contract error envelope to its contract status (409 conflict)", async () => {
		mockFetchFn.mockResolvedValueOnce(
			upstreamJson(409, {
				error: { code: "INSTANCE_CONFLICT", message: "Memory cache instance changed" },
			}),
		);
		const res = await GET(makeGet(""), ctx);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("INSTANCE_CONFLICT");
		expect(res.headers.get("Cache-Control")).toBe("no-store");
	});

	it("wraps non-JSON, malformed, or oversized upstream responses as 502", async () => {
		mockFetchFn.mockResolvedValueOnce(
			new Response("<html>bad gateway</html>", {
				status: 502,
				headers: { "Content-Type": "text/html" },
			}),
		);
		const res = await GET(makeGet(""), ctx);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");

		mockFetchFn.mockResolvedValueOnce(upstreamJson(200, { data: { instance: {} } }));
		const res2 = await GET(makeGet(""), ctx);
		expect(res2.status).toBe(502);

		mockFetchFn.mockResolvedValueOnce(
			new Response("x".repeat(64), {
				status: 200,
				headers: { "Content-Type": "application/json", "Content-Length": String(3 * 1024 * 1024) },
			}),
		);
		const res3 = await GET(makeGet(""), ctx);
		expect(res3.status).toBe(502);

		// A data envelope on a failed HTTP status is not accepted.
		mockFetchFn.mockResolvedValueOnce(upstreamJson(500, { data: OVERVIEW_DATA }));
		const res4 = await GET(makeGet(""), ctx);
		expect(res4.status).toBe(502);

		// An error envelope whose status disagrees with the HTTP status is not accepted.
		mockFetchFn.mockResolvedValueOnce(
			upstreamJson(200, { error: { code: "INSTANCE_CONFLICT", message: "stale" } }),
		);
		const res5 = await GET(makeGet(""), ctx);
		expect(res5.status).toBe(502);
	});

	it("maps an unknown upstream error code to 502 and never leaks the key", async () => {
		mockFetchFn.mockResolvedValueOnce(
			upstreamJson(500, { error: { code: "SOMETHING_ELSE", message: "boom" } }),
		);
		const res = await GET(makeGet(""), ctx);
		expect(res.status).toBe(502);
		const text = await res.text();
		expect(text).not.toContain(ADMIN_KEY);
	});

	it("requires an admin session", async () => {
		mockResolveAdmin.mockReturnValueOnce(null);
		const res = await GET(makeGet(""), ctx);
		expect(res.status).toBe(401);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(mockFetchFn).not.toHaveBeenCalled();
	});

	it("returns CSRF rejection with 403 and no-store without calling upstream", async () => {
		const { validateOrigin } = await import("@/lib/csrf");
		vi.mocked(validateOrigin).mockReturnValueOnce(false);
		const res = await POST(makePost(JSON.stringify({ instanceId: "web-1", action: "clear" })), ctx);
		expect(res.status).toBe(403);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(mockFetchFn).not.toHaveBeenCalled();
	});
});

describe("POST /api/admin/memory-cache", () => {
	it("allows the Web flush deadline plus transport overhead", async () => {
		const timeout = vi.spyOn(AbortSignal, "timeout");
		try {
			mockFetchFn.mockResolvedValueOnce(upstreamJson(200, { data: { ok: true } }));
			const response = await POST(
				makePost(JSON.stringify({ instanceId: "web-1", action: "flush" })),
				ctx,
			);
			expect(response.status).toBe(200);
			expect(timeout).toHaveBeenCalledWith(40_000);
		} finally {
			timeout.mockRestore();
		}
	});

	it("forwards a valid mutation and returns {data:{ok:true}} with no-store", async () => {
		mockFetchFn.mockResolvedValueOnce(upstreamJson(200, { data: { ok: true } }));
		const res = await POST(makePost(JSON.stringify({ instanceId: "web-1", action: "flush" })), ctx);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("no-store");
		expect(await res.json()).toEqual({ data: { ok: true } });

		const [url, opts] = mockFetchFn.mock.calls[0] as [URL, RequestInit];
		expect(url.pathname).toBe("/api/internal/memory-cache");
		expect(opts.body).toBe(JSON.stringify({ instanceId: "web-1", action: "flush" }));
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Ellie-Memory-Key"]).toBe(ADMIN_KEY);
		expect(headers["Content-Type"]).toBe("application/json");
	});

	it("rejects invalid bodies locally with 400 (unknown action/field, bad instanceId)", async () => {
		for (const body of [
			JSON.stringify({ instanceId: "web-1", action: "nuke" }),
			JSON.stringify({ instanceId: "web-1", action: "clear", extra: 1 }),
			JSON.stringify({ instanceId: "bad id!", action: "clear" }),
			JSON.stringify({ instanceId: "web-1", action: "flush", family: "forum-read" }),
			JSON.stringify({ instanceId: "web-1", action: "clear", key: "k" }),
			"not json",
		]) {
			const res = await POST(makePost(body), ctx);
			expect(res.status).toBe(400);
			const parsed = (await res.json()) as { error: { code: string } };
			expect(parsed.error.code).toBe("BAD_REQUEST");
		}
		expect(mockFetchFn).not.toHaveBeenCalled();
	});

	it("passes an upstream 409 instance conflict through", async () => {
		mockFetchFn.mockResolvedValueOnce(
			upstreamJson(409, {
				error: { code: "INSTANCE_CONFLICT", message: "Memory cache instance changed" },
			}),
		);
		const res = await POST(makePost(JSON.stringify({ instanceId: "old", action: "flush" })), ctx);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INSTANCE_CONFLICT");
	});

	it("rejects a malformed mutation success payload as 502", async () => {
		mockFetchFn.mockResolvedValueOnce(upstreamJson(200, { data: { ok: "yes" } }));
		const res = await POST(makePost(JSON.stringify({ instanceId: "web-1", action: "flush" })), ctx);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("UPSTREAM_UNAVAILABLE");
	});

	it("fails closed when not configured", async () => {
		Reflect.deleteProperty(process.env, "MEMORY_CACHE_ADMIN_KEY");
		const res = await POST(makePost(JSON.stringify({ instanceId: "web-1", action: "clear" })), ctx);
		expect(res.status).toBe(503);
		expect(mockFetchFn).not.toHaveBeenCalled();
	});
});
