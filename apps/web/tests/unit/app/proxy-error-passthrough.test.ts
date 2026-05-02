// Behavioral tests for the Next.js proxy routes covered by R1-A.
//
// These prove the unified error contract every mutating proxy depends on:
//   - Origin/CSRF rejection happens before any session/Worker call.
//   - 401 NOT_AUTHENTICATED uses the wrapped `{ error: { code, message } }` shape.
//   - The docs/17 §5.4 flat EMAIL_NOT_VERIFIED payload is forwarded verbatim with
//     the Worker's original status (403).
//   - Other ForumApiError instances are collapsed to the wrapped shape with the
//     Worker's original status code preserved.
//
// `forum-api`, `forum-auth`, and `getToken` are mocked so no real network or
// session state is touched.

import { ForumApiError } from "@/lib/forum-api";
import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postAuthMock = vi.fn();
const patchAuthMock = vi.fn();
const getWorkerJwtMock = vi.fn();
const authPatchMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: {
			postAuth: (...args: unknown[]) => postAuthMock(...args),
			patchAuth: (...args: unknown[]) => patchAuthMock(...args),
		},
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: () => getWorkerJwtMock(),
	authPatch: (...args: unknown[]) => authPatchMock(...args),
}));

beforeEach(() => {
	postAuthMock.mockReset();
	patchAuthMock.mockReset();
	getWorkerJwtMock.mockReset();
	authPatchMock.mockReset();
	fetchMock.mockReset();
	process.env.AUTH_URL = "https://web.example.com";
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.FORUM_API_KEY = "test-key";
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

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

// ─── POST /api/v1/threads (a regular write proxy) ─────────────────────────

describe("POST /api/v1/threads", () => {
	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { POST } = await import("@/app/api/v1/threads/route");
		const res = await POST(
			makeJsonRequest("https://web.example.com/api/v1/threads", { title: "t" }, { origin: null }),
		);
		expect(res.status).toBe(403);
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("returns 401 wrapped { error: { code, message } } when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/v1/threads/route");
		const res = await POST(
			makeJsonRequest("https://web.example.com/api/v1/threads", { title: "t" }),
		);
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
		const { POST } = await import("@/app/api/v1/threads/route");
		const res = await POST(
			makeJsonRequest("https://web.example.com/api/v1/threads", { title: "t" }),
		);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("collapses other ForumApiError into wrapped shape and preserves status", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(429, { code: "RATE_LIMITED", message: "Slow down" });
		err.rawBody = { error: { code: "RATE_LIMITED", message: "Slow down" } };
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/threads/route");
		const res = await POST(
			makeJsonRequest("https://web.example.com/api/v1/threads", { title: "t" }),
		);
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "RATE_LIMITED", message: "Slow down" } });
	});
});

// ─── PATCH /api/v1/users/me ──────────────────────────────────────────────

describe("PATCH /api/v1/users/me", () => {
	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { PATCH } = await import("@/app/api/v1/users/me/route");
		const res = await PATCH(
			makeJsonRequest(
				"https://web.example.com/api/v1/users/me",
				{ display_name: "new" },
				{ method: "PATCH", origin: null },
			),
		);
		expect(res.status).toBe(403);
		expect(authPatchMock).not.toHaveBeenCalled();
	});

	it("returns 401 wrapped shape when authPatch reports NOT_AUTHENTICATED", async () => {
		authPatchMock.mockResolvedValue({ error: "NOT_AUTHENTICATED" });
		const { PATCH } = await import("@/app/api/v1/users/me/route");
		const res = await PATCH(
			makeJsonRequest(
				"https://web.example.com/api/v1/users/me",
				{ display_name: "new" },
				{ method: "PATCH" },
			),
		);
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });
	});

	it("forwards the docs/17 §5.4 flat payload verbatim on 403 EMAIL_NOT_VERIFIED", async () => {
		const err = new ForumApiError(403, {
			code: "EMAIL_NOT_VERIFIED",
			message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		});
		err.rawBody = EMAIL_NOT_VERIFIED_PAYLOAD;
		authPatchMock.mockRejectedValue(err);
		const { PATCH } = await import("@/app/api/v1/users/me/route");
		const res = await PATCH(
			makeJsonRequest(
				"https://web.example.com/api/v1/users/me",
				{ display_name: "new" },
				{ method: "PATCH" },
			),
		);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("collapses other ForumApiError into wrapped shape and preserves status", async () => {
		const err = new ForumApiError(409, { code: "DISPLAY_NAME_TAKEN", message: "Already used" });
		err.rawBody = { error: { code: "DISPLAY_NAME_TAKEN", message: "Already used" } };
		authPatchMock.mockRejectedValue(err);
		const { PATCH } = await import("@/app/api/v1/users/me/route");
		const res = await PATCH(
			makeJsonRequest(
				"https://web.example.com/api/v1/users/me",
				{ display_name: "new" },
				{ method: "PATCH" },
			),
		);
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "DISPLAY_NAME_TAKEN", message: "Already used" } });
	});
});

// ─── POST /api/v1/upload (raw fetch path) ────────────────────────────────

function makeMultipartRequest(opts: { origin?: string | null } = {}): Request {
	const headers: Record<string, string> = {
		"Content-Type": "multipart/form-data; boundary=----test",
	};
	if (opts.origin !== null) {
		headers.Origin = opts.origin ?? "https://web.example.com";
	}
	return new Request("https://web.example.com/api/v1/upload", {
		method: "POST",
		headers,
		body: "----test--\r\n",
	});
}

describe("POST /api/v1/upload", () => {
	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { POST } = await import("@/app/api/v1/upload/route");
		const res = await POST(makeMultipartRequest({ origin: null }));
		expect(res.status).toBe(403);
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("returns 401 wrapped shape when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/v1/upload/route");
		const res = await POST(makeMultipartRequest());
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("forwards the docs/17 §5.4 flat payload verbatim on 403 EMAIL_NOT_VERIFIED", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify(EMAIL_NOT_VERIFIED_PAYLOAD), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const { POST } = await import("@/app/api/v1/upload/route");
		const res = await POST(makeMultipartRequest());
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("forwards wrapped Worker error verbatim on non-2xx", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ error: { code: "FILE_TOO_LARGE", message: "Too big" } }), {
				status: 413,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const { POST } = await import("@/app/api/v1/upload/route");
		const res = await POST(makeMultipartRequest());
		expect(res.status).toBe(413);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "FILE_TOO_LARGE", message: "Too big" } });
	});

	it("returns the Worker success body verbatim on 2xx", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const okBody = { data: { url: "https://cdn.example.com/x.png" }, meta: { requestId: "r1" } };
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify(okBody), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const { POST } = await import("@/app/api/v1/upload/route");
		const res = await POST(makeMultipartRequest());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual(okBody);
	});
});
