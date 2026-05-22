// Behavioral tests for GET /api/v1/forums (R2-A).
//
// The Worker forum list endpoint accepts an optional bearer token. The
// proxy must:
//   - call `forumApi.getAuth("/api/v1/forums", jwt)` when a session JWT is
//     available
//   - call `forumApi.getAll("/api/v1/forums")` when no JWT (anonymous)
//   - degrade to public listing if `getWorkerJwt` throws (broken session
//     should not 500 the public forum list)
//   - collapse `ForumApiError` via the shared
//     `forumApiErrorToProxyResponse` helper, preserving status

import { ForumApiError } from "@/lib/forum-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getAllMock = vi.fn();
const getAuthMock = vi.fn();
const getWorkerJwtMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: {
			getAll: (...args: unknown[]) => getAllMock(...args),
			getAuth: (...args: unknown[]) => getAuthMock(...args),
		},
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: () => getWorkerJwtMock(),
}));

vi.mock("@/lib/client-ip", () => ({
	extractClientIp: () => "",
}));

const mockRequest = new Request("https://web.example.com/api/v1/forums");

beforeEach(() => {
	getAllMock.mockReset();
	getAuthMock.mockReset();
	getWorkerJwtMock.mockReset();
});

afterEach(() => {
	vi.resetModules();
});

describe("GET /api/v1/forums", () => {
	it("uses public getAll when no session JWT is available", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const ok = { data: [{ id: 1, name: "General" }], meta: { timestamp: 0, requestId: "r1" } };
		getAllMock.mockResolvedValue(ok);
		const { GET } = await import("@/app/api/v1/forums/route");
		const res = await GET(mockRequest);
		expect(res.status).toBe(200);
		expect(getAllMock).toHaveBeenCalledTimes(1);
		expect(getAllMock).toHaveBeenCalledWith("/api/v1/forums");
		expect(getAuthMock).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(ok);
	});

	it("uses getAuth with the JWT when a session is present", async () => {
		getWorkerJwtMock.mockResolvedValue("jwt-abc");
		const ok = { data: [{ id: 2, name: "Private" }], meta: { timestamp: 1, requestId: "r2" } };
		getAuthMock.mockResolvedValue(ok);
		const { GET } = await import("@/app/api/v1/forums/route");
		const res = await GET(mockRequest);
		expect(res.status).toBe(200);
		expect(getAuthMock).toHaveBeenCalledTimes(1);
		expect(getAuthMock).toHaveBeenCalledWith("/api/v1/forums", "jwt-abc", undefined, {
			ip: undefined,
			userAgent: undefined,
		});
		expect(getAllMock).not.toHaveBeenCalled();
		expect(await res.json()).toEqual(ok);
	});

	it("falls back to public listing when getWorkerJwt throws (broken session)", async () => {
		getWorkerJwtMock.mockRejectedValue(new Error("malformed cookie"));
		const ok = { data: [], meta: { timestamp: 0, requestId: "r3" } };
		getAllMock.mockResolvedValue(ok);
		const { GET } = await import("@/app/api/v1/forums/route");
		const res = await GET(mockRequest);
		// Must NOT 500 — public forum list should still load.
		expect(res.status).toBe(200);
		expect(getAllMock).toHaveBeenCalledTimes(1);
		expect(getAuthMock).not.toHaveBeenCalled();
	});

	it("collapses ForumApiError into wrapped { error: { code, message } } and preserves status", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const err = new ForumApiError(503, { code: "DB_UNAVAILABLE", message: "DB down" });
		err.rawBody = { error: { code: "DB_UNAVAILABLE", message: "DB down" } };
		getAllMock.mockRejectedValue(err);
		const { GET } = await import("@/app/api/v1/forums/route");
		const res = await GET(mockRequest);
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({
			error: { code: "DB_UNAVAILABLE", message: "DB down" },
		});
	});

	it("returns 500 INTERNAL_ERROR for non-ForumApiError exceptions", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		getAllMock.mockRejectedValue(new Error("network blew up"));
		const { GET } = await import("@/app/api/v1/forums/route");
		const res = await GET(mockRequest);
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body).toEqual({
			error: { code: "INTERNAL_ERROR", message: "Internal server error" },
		});
	});
});
