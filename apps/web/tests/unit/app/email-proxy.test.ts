// Behavioral tests for the two email-verification proxy routes.
//
// These prove the wire contract the EmailVerificationCard depends on:
//   - request-code forwards only `{ email }` to the Worker.
//   - verify forwards `{ email, code }` (no captcha token).
//   - both routes propagate the docs/17 §5.4 flat payload unmodified.
//   - both routes reject CSRF before touching the Worker / session.
//
// They mock `forum-api` and `forum-auth` so no real network/DB/cookie state
// is involved.

import { ForumApiError } from "@/lib/forum-api";
import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postAuthMock = vi.fn();
const getWorkerJwtMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	// Keep the real ForumApiError so `instanceof` checks in the route still match.
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: { postAuth: (...args: unknown[]) => postAuthMock(...args) },
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: () => getWorkerJwtMock(),
}));

vi.mock("@/lib/client-ip", () => ({
	extractClientIp: () => "",
}));

const emptyClient = { ip: undefined, userAgent: undefined };

beforeEach(() => {
	postAuthMock.mockReset();
	getWorkerJwtMock.mockReset();
	process.env.AUTH_URL = "https://web.example.com";
});

afterEach(() => {
	vi.resetModules();
});

function makeRequest(body: unknown, opts: { origin?: string | null } = {}): Request {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (opts.origin !== null) {
		headers.Origin = opts.origin ?? "https://web.example.com";
	}
	return new Request("https://web.example.com/api/v1/users/me/email/request-code", {
		method: "POST",
		headers,
		body: JSON.stringify(body),
	});
}

describe("POST /api/v1/users/me/email/request-code", () => {
	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { POST } = await import("@/app/api/v1/users/me/email/request-code/route");
		const res = await POST(makeRequest({ email: "x@y.io" }, { origin: null }));
		expect(res.status).toBe(403);
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("returns 401 when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/v1/users/me/email/request-code/route");
		const res = await POST(makeRequest({ email: "x@y.io" }));
		expect(res.status).toBe(401);
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("forwards only { email } to the Worker", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		postAuthMock.mockResolvedValue({
			data: { sent_to: "x***@y.io" },
			meta: { timestamp: 1, requestId: "r1" },
		});
		const { POST } = await import("@/app/api/v1/users/me/email/request-code/route");
		const res = await POST(makeRequest({ email: "x@y.io" }));
		expect(res.status).toBe(200);
		expect(postAuthMock).toHaveBeenCalledWith(
			"/api/v1/users/me/email/request-code",
			{ email: "x@y.io" },
			"jwt-abc",
			emptyClient,
		);
	});

	it("projects body to EmailRequestCodeBody — only email, strips extras", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		postAuthMock.mockResolvedValue({
			data: { sent_to: "x***@y.io" },
			meta: { timestamp: 1, requestId: "r1" },
		});
		const { POST } = await import("@/app/api/v1/users/me/email/request-code/route");
		const res = await POST(
			makeRequest({
				email: "x@y.io",
				cf_turnstile_token: "tok-xyz",
				code: "999999",
				role: "admin",
			}),
		);
		expect(res.status).toBe(200);
		expect(postAuthMock).toHaveBeenCalledTimes(1);
		const [, forwardedBody] = postAuthMock.mock.calls[0];
		expect(forwardedBody).toEqual({ email: "x@y.io" });
		expect(Object.keys(forwardedBody as Record<string, unknown>)).toEqual(["email"]);
	});

	it("forwards the docs/17 §5.4 flat payload verbatim on 403 EMAIL_NOT_VERIFIED", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(403, {
			code: "EMAIL_NOT_VERIFIED",
			message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		});
		err.rawBody = EMAIL_NOT_VERIFIED_PAYLOAD;
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/users/me/email/request-code/route");
		const res = await POST(makeRequest({ email: "x@y.io" }));
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});

	it("collapses other ForumApiError into wrapped { error: { code, message } } shape", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(429, {
			code: "CODE_RESEND_THROTTLED",
			message: "Too soon",
		});
		err.rawBody = { error: { code: "CODE_RESEND_THROTTLED", message: "Too soon" } };
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/users/me/email/request-code/route");
		const res = await POST(makeRequest({ email: "x@y.io" }));
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body).toEqual({ error: { code: "CODE_RESEND_THROTTLED", message: "Too soon" } });
	});
});

describe("POST /api/v1/users/me/email/verify", () => {
	function makeVerifyRequest(body: unknown, opts: { origin?: string | null } = {}): Request {
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (opts.origin !== null) {
			headers.Origin = opts.origin ?? "https://web.example.com";
		}
		return new Request("https://web.example.com/api/v1/users/me/email/verify", {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});
	}

	it("rejects requests with bad/missing Origin (CSRF) before touching session", async () => {
		const { POST } = await import("@/app/api/v1/users/me/email/verify/route");
		const res = await POST(
			makeVerifyRequest({ email: "x@y.io", code: "123456" }, { origin: null }),
		);
		expect(res.status).toBe(403);
		expect(getWorkerJwtMock).not.toHaveBeenCalled();
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("returns 401 when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { POST } = await import("@/app/api/v1/users/me/email/verify/route");
		const res = await POST(makeVerifyRequest({ email: "x@y.io", code: "123456" }));
		expect(res.status).toBe(401);
		expect(postAuthMock).not.toHaveBeenCalled();
	});

	it("forwards { email, code } verbatim — the body must NOT contain cf_turnstile_token", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		postAuthMock.mockResolvedValue({
			data: { verified: true },
			meta: { timestamp: 1, requestId: "r1" },
		});
		const { POST } = await import("@/app/api/v1/users/me/email/verify/route");
		const res = await POST(makeVerifyRequest({ email: "x@y.io", code: "123456" }));
		expect(res.status).toBe(200);
		expect(postAuthMock).toHaveBeenCalledTimes(1);
		const [, forwardedBody] = postAuthMock.mock.calls[0];
		expect(forwardedBody).toEqual({ email: "x@y.io", code: "123456" });
		expect((forwardedBody as Record<string, unknown>).cf_turnstile_token).toBeUndefined();
	});

	it("strips cf_turnstile_token and any extra fields when caller injects them", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		postAuthMock.mockResolvedValue({
			data: { verified: true },
			meta: { timestamp: 1, requestId: "r1" },
		});
		const { POST } = await import("@/app/api/v1/users/me/email/verify/route");
		const res = await POST(
			makeVerifyRequest({
				email: "x@y.io",
				code: "123456",
				cf_turnstile_token: "should-be-dropped",
				extra: "also-dropped",
				role: "admin",
			}),
		);
		expect(res.status).toBe(200);
		expect(postAuthMock).toHaveBeenCalledTimes(1);
		const [, forwardedBody] = postAuthMock.mock.calls[0];
		expect(forwardedBody).toEqual({ email: "x@y.io", code: "123456" });
		expect(Object.keys(forwardedBody as Record<string, unknown>).sort()).toEqual(["code", "email"]);
	});

	it("forwards the docs/17 §5.4 flat payload verbatim on 403 EMAIL_NOT_VERIFIED", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const err = new ForumApiError(403, {
			code: "EMAIL_NOT_VERIFIED",
			message: EMAIL_NOT_VERIFIED_PAYLOAD.message,
		});
		err.rawBody = EMAIL_NOT_VERIFIED_PAYLOAD;
		postAuthMock.mockRejectedValue(err);
		const { POST } = await import("@/app/api/v1/users/me/email/verify/route");
		const res = await POST(makeVerifyRequest({ email: "x@y.io", code: "123456" }));
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
	});
});
