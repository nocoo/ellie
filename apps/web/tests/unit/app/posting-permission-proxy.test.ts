import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────

const getAuthMock = vi.fn();
const getWorkerJwtMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: {
			getAuth: (...args: unknown[]) => getAuthMock(...args),
		},
	};
});

vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: () => getWorkerJwtMock(),
}));

// ─── Setup ───────────────────────────────────────────────────────

beforeEach(() => {
	getAuthMock.mockReset();
	getWorkerJwtMock.mockReset();
});

afterEach(() => {
	vi.resetModules();
});

// ─── Tests ───────────────────────────────────────────────────────

describe("GET /api/v1/posting-permission proxy route", () => {
	it("returns 401 when not authenticated", async () => {
		getWorkerJwtMock.mockResolvedValue(null);
		const { GET } = await import("@/app/api/v1/posting-permission/route");
		const req = new Request("https://localhost/api/v1/posting-permission");
		const res = await GET(req);
		expect(res.status).toBe(401);
	});

	it("forwards response from Worker when authenticated", async () => {
		getWorkerJwtMock.mockResolvedValue("test-jwt");
		getAuthMock.mockResolvedValue({ data: { allowed: true } });
		const { GET } = await import("@/app/api/v1/posting-permission/route");
		const req = new Request("https://localhost/api/v1/posting-permission");
		const res = await GET(req);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.allowed).toBe(true);
	});

	it("forwards ?action=thread to Worker via searchParams", async () => {
		getWorkerJwtMock.mockResolvedValue("test-jwt");
		getAuthMock.mockResolvedValue({ data: { allowed: true } });
		const { GET } = await import("@/app/api/v1/posting-permission/route");
		const req = new Request("https://localhost/api/v1/posting-permission?action=thread");
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(getAuthMock).toHaveBeenCalledWith("/api/v1/posting-permission", "test-jwt", {
			action: "thread",
		});
	});

	it("forwards ?action=reply to Worker via searchParams", async () => {
		getWorkerJwtMock.mockResolvedValue("test-jwt");
		getAuthMock.mockResolvedValue({ data: { allowed: true } });
		const { GET } = await import("@/app/api/v1/posting-permission/route");
		const req = new Request("https://localhost/api/v1/posting-permission?action=reply");
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(getAuthMock).toHaveBeenCalledWith("/api/v1/posting-permission", "test-jwt", {
			action: "reply",
		});
	});

	it("omits searchParams when no action is provided", async () => {
		getWorkerJwtMock.mockResolvedValue("test-jwt");
		getAuthMock.mockResolvedValue({ data: { allowed: true } });
		const { GET } = await import("@/app/api/v1/posting-permission/route");
		const req = new Request("https://localhost/api/v1/posting-permission");
		const res = await GET(req);
		expect(res.status).toBe(200);
		expect(getAuthMock).toHaveBeenCalledWith("/api/v1/posting-permission", "test-jwt", undefined);
	});

	it("returns ForumApiError as proxy response", async () => {
		const { ForumApiError } = await import("@/lib/forum-api");
		getWorkerJwtMock.mockResolvedValue("test-jwt");
		getAuthMock.mockRejectedValue(new ForumApiError(403, "FORBIDDEN", "Forbidden"));
		const { GET } = await import("@/app/api/v1/posting-permission/route");
		const req = new Request("https://localhost/api/v1/posting-permission?action=thread");
		const res = await GET(req);
		expect(res.status).toBe(403);
	});
});
