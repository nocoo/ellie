// Behavioral tests for the three post-rating proxy routes (docs/22 §6).
//
// Reviewer scope (Phase 6 / msg=caf04262 + msg=965f4862): the route-level
// suite must cover the 204-revoke channel and ForumApiError → wrapped-error
// passthrough — not just the happy paths. These three routes are the only
// browser-facing entry into the Worker rating endpoints, so any breakage
// here surfaces directly in the dialog / popover / revoke UI.
//
// Mocks the same way as `proxy-error-passthrough.test.ts`: `forum-api`,
// `forum-auth`, and CSRF helpers stay real; everything past the proxy
// boundary is stubbed.

import { ForumApiError } from "@/lib/forum-api";
import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postAuthMock = vi.fn();
const getMock = vi.fn();
const getAuthMock = vi.fn();
const getWorkerJwtMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: {
			postAuth: (...args: unknown[]) => postAuthMock(...args),
			get: (...args: unknown[]) => getMock(...args),
			getAuth: (...args: unknown[]) => getAuthMock(...args),
		},
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: () => getWorkerJwtMock(),
}));

beforeEach(() => {
	postAuthMock.mockReset();
	getMock.mockReset();
	getAuthMock.mockReset();
	getWorkerJwtMock.mockReset();
	process.env.AUTH_URL = "https://web.example.com";
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.FORUM_API_KEY = "test-key";
});

afterEach(() => {
	vi.resetModules();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJsonRequest(
	url: string,
	body: unknown,
	opts: { method?: string; origin?: string | null } = {},
): Request {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (opts.origin !== null) {
		headers.Origin = opts.origin ?? "https://web.example.com";
	}
	return new Request(url, {
		method: opts.method ?? "POST",
		headers,
		body: JSON.stringify(body),
	});
}

function makeGetRequest(url: string): Request {
	return new Request(url, { method: "GET" });
}

// ─── POST /api/v1/posts/:id/rate ──────────────────────────────────────────────

describe("POST /api/v1/posts/:id/rate", () => {
	const url = "https://web.example.com/api/v1/posts/42/rate";
	const params = Promise.resolve({ id: "42" });
	const sampleBody = { dimension: "coins", score: 5, reason: "great", notifyAuthor: true };

	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { POST } = await import("@/app/api/v1/posts/[id]/rate/route");
		const res = await POST(makeJsonRequest(url, sampleBody, { origin: null }), { params });
		expect(res.status).toBe(403);
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("returns 401 wrapped { error: { code, message } } when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/v1/posts/[id]/rate/route");
		const res = await POST(makeJsonRequest(url, sampleBody), { params });
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });
	});

	it("forwards the docs/17 §5.4 flat payload verbatim on 403 EMAIL_NOT_VERIFIED", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(403, {
			code: "EMAIL_NOT_VERIFIED",
			message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		});
		err.rawBody = EMAIL_NOT_VERIFIED_PAYLOAD;
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/posts/[id]/rate/route");
		const res = await POST(makeJsonRequest(url, sampleBody), { params });
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("collapses other ForumApiError into wrapped shape and preserves status (RATING_DUPLICATE)", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(409, { code: "RATING_DUPLICATE", message: "Already rated" });
		err.rawBody = { error: { code: "RATING_DUPLICATE", message: "Already rated" } };
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/posts/[id]/rate/route");
		const res = await POST(makeJsonRequest(url, sampleBody), { params });
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "RATING_DUPLICATE", message: "Already rated" } });
	});

	it("forwards 429 RATING_DAILY_LIMIT verbatim", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(429, { code: "RATING_DAILY_LIMIT", message: "Too many" });
		err.rawBody = { error: { code: "RATING_DAILY_LIMIT", message: "Too many" } };
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/posts/[id]/rate/route");
		const res = await POST(makeJsonRequest(url, sampleBody), { params });
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "RATING_DAILY_LIMIT", message: "Too many" } });
	});

	it("returns Worker payload with 201 status on success", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const workerResponse = {
			rating: { id: 7, dimension: "coins", score: 5 },
			aggregate: { total: 1, credits: { count: 0, sum: 0 }, coins: { count: 1, sum: 5 } },
		};
		postAuthMock.mockResolvedValue(workerResponse);
		const { POST } = await import("@/app/api/v1/posts/[id]/rate/route");
		const res = await POST(makeJsonRequest(url, sampleBody), { params });
		expect(res.status).toBe(201);
		expect(postAuthMock).toHaveBeenCalledWith("/api/v1/posts/42/rate", sampleBody, "jwt-abc");
		expect(await res.json()).toEqual(workerResponse);
	});
});

// ─── GET /api/v1/posts/:id/ratings (optional-auth) ────────────────────────────

describe("GET /api/v1/posts/:id/ratings", () => {
	const url = "https://web.example.com/api/v1/posts/42/ratings";
	const params = Promise.resolve({ id: "42" });

	it("uses anonymous Worker call when no JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const response = {
			postId: 42,
			threadId: 7,
			aggregate: { total: 0, credits: { count: 0, sum: 0 }, coins: { count: 0, sum: 0 } },
			items: [],
		};
		getMock.mockResolvedValue(response);
		const { GET } = await import("@/app/api/v1/posts/[id]/ratings/route");
		const res = await GET(makeGetRequest(url), { params });
		expect(res.status).toBe(200);
		expect(getMock).toHaveBeenCalledWith("/api/v1/posts/42/ratings");
		expect(getAuthMock).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(response);
	});

	it("uses authenticated Worker call when a JWT is available (canRevoke decided by Worker)", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const response = { postId: 42, threadId: 7, aggregate: { total: 0 }, items: [] };
		getAuthMock.mockResolvedValue(response);
		const { GET } = await import("@/app/api/v1/posts/[id]/ratings/route");
		const res = await GET(makeGetRequest(url), { params });
		expect(res.status).toBe(200);
		expect(getAuthMock).toHaveBeenCalledWith("/api/v1/posts/42/ratings", "jwt-abc");
		expect(getMock).not.toHaveBeenCalled();
	});

	it("falls back to anonymous when getWorkerJwt throws (session layer broken)", async () => {
		getWorkerJwtMock.mockRejectedValue(new Error("session blew up"));
		const response = { postId: 42, threadId: 7, aggregate: { total: 0 }, items: [] };
		getMock.mockResolvedValue(response);
		const { GET } = await import("@/app/api/v1/posts/[id]/ratings/route");
		const res = await GET(makeGetRequest(url), { params });
		expect(res.status).toBe(200);
		expect(getMock).toHaveBeenCalledWith("/api/v1/posts/42/ratings");
	});

	it("forwards ForumApiError verbatim (e.g. 404 NOT_FOUND on hidden post)", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(404, { code: "NOT_FOUND", message: "post not found" });
		err.rawBody = { error: { code: "NOT_FOUND", message: "post not found" } };
		getAuthMock.mockRejectedValue(err);
		const { GET } = await import("@/app/api/v1/posts/[id]/ratings/route");
		const res = await GET(makeGetRequest(url), { params });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "post not found" } });
	});

	it("returns 500 INTERNAL_ERROR on unknown errors", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		getAuthMock.mockRejectedValue(new Error("kaboom"));
		const { GET } = await import("@/app/api/v1/posts/[id]/ratings/route");
		const res = await GET(makeGetRequest(url), { params });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
	});
});

// ─── POST /api/v1/posts/:id/ratings/:ratingId/revoke ─────────────────────────

describe("POST /api/v1/posts/:id/ratings/:ratingId/revoke (204 channel)", () => {
	const url = "https://web.example.com/api/v1/posts/42/ratings/7/revoke";
	const params = Promise.resolve({ id: "42", ratingId: "7" });

	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { POST } = await import("@/app/api/v1/posts/[id]/ratings/[ratingId]/revoke/route");
		const res = await POST(makeJsonRequest(url, {}, { origin: null }) as any, { params });
		expect(res.status).toBe(403);
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("returns 401 wrapped shape when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/v1/posts/[id]/ratings/[ratingId]/revoke/route");
		const res = await POST(makeJsonRequest(url, {}) as any, { params });
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });
	});

	it("returns 204 with no body on success (matches Worker contract)", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		postAuthMock.mockResolvedValue(undefined);
		const { POST } = await import("@/app/api/v1/posts/[id]/ratings/[ratingId]/revoke/route");
		const res = await POST(makeJsonRequest(url, {}) as any, { params });
		expect(res.status).toBe(204);
		// 204 must have an empty body — no stray "{}" payload.
		const text = await res.text();
		expect(text).toBe("");
		expect(postAuthMock).toHaveBeenCalledWith("/api/v1/posts/42/ratings/7/revoke", {}, "jwt-abc");
	});

	it("forwards 404 NOT_FOUND verbatim (already-revoked / non-existent row)", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(404, { code: "NOT_FOUND", message: "gone" });
		err.rawBody = { error: { code: "NOT_FOUND", message: "gone" } };
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/posts/[id]/ratings/[ratingId]/revoke/route");
		const res = await POST(makeJsonRequest(url, {}) as any, { params });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "gone" } });
	});

	it("forwards 403 FORBIDDEN_MOD_ONLY verbatim (User/Mod cannot revoke)", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(403, {
			code: "FORBIDDEN_MOD_ONLY",
			message: "Admin/SuperMod only",
		});
		err.rawBody = { error: { code: "FORBIDDEN_MOD_ONLY", message: "Admin/SuperMod only" } };
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/posts/[id]/ratings/[ratingId]/revoke/route");
		const res = await POST(makeJsonRequest(url, {}) as any, { params });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({
			error: { code: "FORBIDDEN_MOD_ONLY", message: "Admin/SuperMod only" },
		});
	});
});
