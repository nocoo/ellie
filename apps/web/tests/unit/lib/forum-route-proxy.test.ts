// Helper unit tests for `lib/forum-route-proxy.ts` (Phase C1).
//
// Covers the contract that future route migrations rely on:
//   - CSRF: bad/missing Origin → 403 CSRF_REJECTED before auth/dispatch.
//   - Auth: `auth: "required"` (default) returns 401 NOT_AUTHENTICATED when
//     `getWorkerJwt()` resolves null; `auth: "none"` (GET only) skips JWT
//     entirely and uses the unauthenticated `forumApi.get`.
//   - Body strategies: `"json"` reads `request.json()`; `"empty"` forwards
//     `{}`; the helper requires a body strategy for every non-GET method
//     (POST/PATCH/DELETE) — none of the dispatch verbs accept undefined.
//   - Query: GET default `"passthrough"` flattens `searchParams` and forwards
//     to `forumApi.get*`; empty search → `undefined`.
//   - successStatus: defaults to 200, overridable to 201 for create routes.
//   - Errors: `ForumApiError` is forwarded through
//     `forumApiErrorToProxyResponse` (preserving the docs/17 §5.4 flat
//     payload). Unknown thrown values collapse to 500 INTERNAL_ERROR.
//
// Mocks the three dependency modules — `@/lib/forum-api`,
// `@/lib/forum-auth`, `@/lib/csrf` — so no real network or env state is
// touched.

import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForumApiError } from "@/lib/forum-api";
import { proxyRoute } from "@/lib/forum-route-proxy";

const getMock = vi.fn();
const getAuthMock = vi.fn();
const postAuthMock = vi.fn();
const patchAuthMock = vi.fn();
const deleteAuthMock = vi.fn();
const getWorkerJwtMock = vi.fn();
const validateOriginMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: {
			get: (...args: unknown[]) => getMock(...args),
			getAuth: (...args: unknown[]) => getAuthMock(...args),
			postAuth: (...args: unknown[]) => postAuthMock(...args),
			patchAuth: (...args: unknown[]) => patchAuthMock(...args),
			deleteAuth: (...args: unknown[]) => deleteAuthMock(...args),
		},
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: () => getWorkerJwtMock(),
}));

vi.mock("@/lib/csrf", async () => {
	const actual = await vi.importActual<typeof import("@/lib/csrf")>("@/lib/csrf");
	return {
		...actual,
		validateOrigin: (req: Request) => validateOriginMock(req),
	};
});

vi.mock("@/lib/client-ip", () => ({
	extractClientIp: () => "",
}));

const emptyClient = { ip: undefined, userAgent: undefined };

beforeEach(() => {
	getMock.mockReset();
	getAuthMock.mockReset();
	postAuthMock.mockReset();
	patchAuthMock.mockReset();
	deleteAuthMock.mockReset();
	getWorkerJwtMock.mockReset();
	validateOriginMock.mockReset();
	// Default: CSRF passes. Individual tests override for rejection cases.
	validateOriginMock.mockReturnValue(true);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
	url: string,
	init: { method?: string; body?: unknown; origin?: string | null } = {},
): NextRequest {
	const headers: Record<string, string> = {};
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (init.origin !== null) headers.Origin = init.origin ?? "https://web.example.com";
	const reqInit: RequestInit = {
		method: init.method ?? "GET",
		headers,
	};
	if (init.body !== undefined) reqInit.body = JSON.stringify(init.body);
	return new NextRequest(url, reqInit);
}

function paramsFor<P>(p: P): { params: Promise<P> } {
	return { params: Promise.resolve(p) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("proxyRoute option validation", () => {
	it("rejects GET with body strategy", () => {
		expect(() =>
			proxyRoute<Record<string, never>>({ method: "GET", path: () => "/x", body: "json" }),
		).toThrow(/GET handlers must not declare a body/);
	});
	it("rejects non-GET without body strategy", () => {
		expect(() => proxyRoute<Record<string, never>>({ method: "POST", path: () => "/x" })).toThrow(
			/POST handlers must declare body/,
		);
	});
	it("rejects non-GET with query mode", () => {
		expect(() =>
			proxyRoute<Record<string, never>>({
				method: "POST",
				path: () => "/x",
				body: "json",
				query: "passthrough",
			}),
		).toThrow(/query is only valid for GET/);
	});
	it('rejects auth:"none" on non-GET', () => {
		expect(() =>
			proxyRoute<Record<string, never>>({
				method: "POST",
				path: () => "/x",
				body: "json",
				auth: "none",
			}),
		).toThrow(/auth: "none" is only supported for GET/);
	});
});

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

describe("CSRF gate", () => {
	it("rejects mutating method when validateOrigin is false (auto)", async () => {
		validateOriginMock.mockReturnValue(false);
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/threads",
			body: "json",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/threads", {
				method: "POST",
				body: { title: "t" },
				origin: null,
			}),
			paramsFor({}),
		);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } });
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("does NOT gate GET requests by default (auto)", async () => {
		validateOriginMock.mockReturnValue(false);
		getAuthMock.mockResolvedValue({ ok: true });
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		const handler = proxyRoute<Record<string, never>>({ method: "GET", path: () => "/forums" });
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/forums", { origin: null }),
			paramsFor({}),
		);
		expect(res.status).toBe(200);
	});

	it('csrf: "always" gates GET too', async () => {
		validateOriginMock.mockReturnValue(false);
		const handler = proxyRoute<Record<string, never>>({
			method: "GET",
			path: () => "/forums",
			csrf: "always",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/forums", { origin: null }),
			paramsFor({}),
		);
		expect(res.status).toBe(403);
	});

	it('csrf: "never" lets a mutating method through with bad origin', async () => {
		validateOriginMock.mockReturnValue(false);
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		postAuthMock.mockResolvedValue({ ok: true });
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "json",
			csrf: "never",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", {
				method: "POST",
				body: {},
				origin: null,
			}),
			paramsFor({}),
		);
		expect(res.status).toBe(200);
	});
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("auth", () => {
	it('"required" returns 401 wrapped when JWT is null', async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "empty",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", { method: "POST", body: {} }),
			paramsFor({}),
		);
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({
			error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" },
		});
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it('"required" returns 500 INTERNAL_ERROR when getWorkerJwt throws', async () => {
		const err = new Error("session blew up");
		getWorkerJwtMock.mockRejectedValue(err);
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "empty",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", { method: "POST", body: {} }),
			paramsFor({}),
		);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			error: { code: "INTERNAL_ERROR", message: "Internal server error" },
		});
		expect(errSpy).toHaveBeenCalled();
	});

	it('"none" skips JWT and dispatches via forumApi.get (public GET)', async () => {
		getMock.mockResolvedValue({ public: true });
		const handler = proxyRoute<Record<string, never>>({
			method: "GET",
			path: () => "/public",
			auth: "none",
		});
		const res = await handler(makeRequest("https://web.example.com/api/v1/public"), paramsFor({}));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ public: true });
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(getAuthMock).not.toHaveBeenCalled();
		expect(getMock).toHaveBeenCalledWith("/public", undefined);
	});

	it('"required" GET dispatches via forumApi.getAuth with the JWT', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		getAuthMock.mockResolvedValue({ data: 1 });
		const handler = proxyRoute<Record<string, never>>({ method: "GET", path: () => "/me" });
		const res = await handler(makeRequest("https://web.example.com/api/v1/me"), paramsFor({}));
		expect(res.status).toBe(200);
		expect(getAuthMock).toHaveBeenCalledWith("/me", "jwt-abc", undefined, emptyClient);
	});
});

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

describe("body strategies", () => {
	it('"json" reads request.json() and forwards on POST', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		postAuthMock.mockResolvedValue({ created: true });
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/threads",
			body: "json",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/threads", {
				method: "POST",
				body: { title: "hello" },
			}),
			paramsFor({}),
		);
		expect(res.status).toBe(200);
		expect(postAuthMock).toHaveBeenCalledWith("/threads", { title: "hello" }, "jwt-x", emptyClient);
	});

	it('"json" reads request.json() and forwards on PATCH', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		patchAuthMock.mockResolvedValue({ updated: true });
		const handler = proxyRoute<{ id: string }>({
			method: "PATCH",
			path: (p) => `/threads/${p.id}`,
			body: "json",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/threads/42", {
				method: "PATCH",
				body: { title: "renamed" },
			}),
			paramsFor({ id: "42" }),
		);
		expect(res.status).toBe(200);
		expect(patchAuthMock).toHaveBeenCalledWith(
			"/threads/42",
			{ title: "renamed" },
			"jwt-x",
			emptyClient,
		);
	});

	it('"empty" forwards {} as body on POST without reading request', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		postAuthMock.mockResolvedValue({ ok: true });
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/checkin",
			body: "empty",
		});
		// Send a body to confirm it is ignored.
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/checkin", {
				method: "POST",
				body: { junk: 1 },
			}),
			paramsFor({}),
		);
		expect(res.status).toBe(200);
		expect(postAuthMock).toHaveBeenCalledWith("/checkin", {}, "jwt-x", emptyClient);
	});

	it('"empty" forwards {} as body on DELETE', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		deleteAuthMock.mockResolvedValue({ removed: true });
		const handler = proxyRoute<{ id: string }>({
			method: "DELETE",
			path: (p) => `/threads/${p.id}`,
			body: "empty",
		});
		const res = await handler(
			new NextRequest("https://web.example.com/api/v1/threads/9", {
				method: "DELETE",
				headers: { Origin: "https://web.example.com" },
			}),
			paramsFor({ id: "9" }),
		);
		expect(res.status).toBe(200);
		expect(deleteAuthMock).toHaveBeenCalledWith("/threads/9", {}, "jwt-x", emptyClient);
	});

	it("returns 400 BAD_REQUEST when JSON body is invalid", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "json",
		});
		const req = new NextRequest("https://web.example.com/api/v1/x", {
			method: "POST",
			headers: { Origin: "https://web.example.com", "Content-Type": "application/json" },
			body: "{ not json",
		});
		const res = await handler(req, paramsFor({}));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({
			error: { code: "BAD_REQUEST", message: "Invalid request body" },
		});
		expect(postAuthMock).not.toHaveBeenCalled();
		expect(errSpy).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

describe("query strategies", () => {
	it('default "passthrough" flattens searchParams', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		getAuthMock.mockResolvedValue({ list: [] });
		const handler = proxyRoute<Record<string, never>>({ method: "GET", path: () => "/threads" });
		await handler(
			makeRequest("https://web.example.com/api/v1/threads?cursor=abc&limit=20"),
			paramsFor({}),
		);
		expect(getAuthMock).toHaveBeenCalledWith(
			"/threads",
			"jwt-x",
			{ cursor: "abc", limit: "20" },
			emptyClient,
		);
	});

	it("passes undefined when search is empty", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		getAuthMock.mockResolvedValue({ list: [] });
		const handler = proxyRoute<Record<string, never>>({ method: "GET", path: () => "/threads" });
		await handler(makeRequest("https://web.example.com/api/v1/threads"), paramsFor({}));
		expect(getAuthMock).toHaveBeenCalledWith("/threads", "jwt-x", undefined, emptyClient);
	});

	it("allowlist mode picks only the listed keys", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		getAuthMock.mockResolvedValue({ list: [] });
		const handler = proxyRoute<Record<string, never>>({
			method: "GET",
			path: () => "/threads",
			query: ["cursor"],
		});
		await handler(
			makeRequest("https://web.example.com/api/v1/threads?cursor=abc&limit=20&secret=oops"),
			paramsFor({}),
		);
		expect(getAuthMock).toHaveBeenCalledWith("/threads", "jwt-x", { cursor: "abc" }, emptyClient);
	});

	it('"none" skips query forwarding even when searchParams are present', async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		getAuthMock.mockResolvedValue({ list: [] });
		const handler = proxyRoute<Record<string, never>>({
			method: "GET",
			path: () => "/threads",
			query: "none",
		});
		await handler(makeRequest("https://web.example.com/api/v1/threads?cursor=abc"), paramsFor({}));
		expect(getAuthMock).toHaveBeenCalledWith("/threads", "jwt-x", undefined, emptyClient);
	});
});

// ---------------------------------------------------------------------------
// Success status
// ---------------------------------------------------------------------------

describe("successStatus", () => {
	it("defaults to 200", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		postAuthMock.mockResolvedValue({ ok: true });
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "empty",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", { method: "POST", body: {} }),
			paramsFor({}),
		);
		expect(res.status).toBe(200);
	});

	it("can be overridden to 201 for create endpoints", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		postAuthMock.mockResolvedValue({ id: "t-1" });
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/threads",
			body: "json",
			successStatus: 201,
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/threads", {
				method: "POST",
				body: { title: "t" },
			}),
			paramsFor({}),
		);
		expect(res.status).toBe(201);
		expect(await res.json()).toEqual({ id: "t-1" });
	});
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

describe("error handling", () => {
	it("forwards ForumApiError via forumApiErrorToProxyResponse — wrapped shape", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		const err = new ForumApiError(409, { code: "DISPLAY_NAME_TAKEN", message: "Already used" });
		postAuthMock.mockRejectedValue(err);
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "empty",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", { method: "POST", body: {} }),
			paramsFor({}),
		);
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({
			error: { code: "DISPLAY_NAME_TAKEN", message: "Already used" },
		});
	});

	it("forwards the docs/17 §5.4 EMAIL_NOT_VERIFIED flat payload verbatim", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		const err = new ForumApiError(403, {
			code: "EMAIL_NOT_VERIFIED",
			message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		});
		err.rawBody = EMAIL_NOT_VERIFIED_PAYLOAD;
		postAuthMock.mockRejectedValue(err);
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "empty",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", { method: "POST", body: {} }),
			paramsFor({}),
		);
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("collapses unknown thrown values to 500 INTERNAL_ERROR", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-x");
		postAuthMock.mockRejectedValue(new Error("boom"));
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = proxyRoute<Record<string, never>>({
			method: "POST",
			path: () => "/x",
			body: "empty",
		});
		const res = await handler(
			makeRequest("https://web.example.com/api/v1/x", { method: "POST", body: {} }),
			paramsFor({}),
		);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({
			error: { code: "INTERNAL_ERROR", message: "Internal server error" },
		});
		expect(errSpy).toHaveBeenCalled();
	});
});
