import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postRawMock = vi.fn();

vi.mock("@/lib/forum-api", async () => {
	const actual = await vi.importActual<typeof import("@/lib/forum-api")>("@/lib/forum-api");
	return {
		...actual,
		forumApi: { postRaw: (...args: unknown[]) => postRawMock(...args) },
	};
});

beforeEach(() => {
	postRawMock.mockReset();
	process.env.AUTH_URL = "https://web.example.com";
	process.env.NODE_ENV = "production";
});

afterEach(() => {
	vi.resetModules();
	process.env.NODE_ENV = "test";
});

function makeRequest(action: string, body: unknown, headers: Record<string, string> = {}): Request {
	return new Request(`https://web.example.com/api/v1/cap/${action}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Origin: "https://web.example.com",
			...headers,
		},
		body: JSON.stringify(body),
	});
}

describe("POST /api/v1/cap/[action]", () => {
	it("rejects CSRF before touching the Worker", async () => {
		const { POST } = await import("@/app/api/v1/cap/[action]/route");
		const res = await POST(makeRequest("challenge", {}, { Origin: "https://evil.example" }), {
			params: Promise.resolve({ action: "challenge" }),
		});
		expect(res.status).toBe(403);
		expect(postRawMock).not.toHaveBeenCalled();
	});

	it("rejects unknown actions", async () => {
		const { POST } = await import("@/app/api/v1/cap/[action]/route");
		const res = await POST(makeRequest("siteverify", {}), {
			params: Promise.resolve({ action: "siteverify" }),
		});
		expect(res.status).toBe(404);
		expect(postRawMock).not.toHaveBeenCalled();
	});

	it("ignores a forged x-forwarded-client-ip in production", async () => {
		postRawMock.mockResolvedValue(new Response(JSON.stringify({ token: "t" }), { status: 200 }));
		const { POST } = await import("@/app/api/v1/cap/[action]/route");
		const res = await POST(
			makeRequest(
				"challenge",
				{},
				{
					"x-forwarded-client-ip": "74.226.88.37",
					"cf-connecting-ip": "203.0.113.9",
				},
			),
			{ params: Promise.resolve({ action: "challenge" }) },
		);
		expect(res.status).toBe(200);
		expect(postRawMock).toHaveBeenCalledWith(
			"/api/v1/cap/challenge",
			{},
			{
				ip: "203.0.113.9",
				userAgent: undefined,
			},
		);
	});

	it("rejects a missing client IP without forwarding", async () => {
		const { POST } = await import("@/app/api/v1/cap/[action]/route");
		const res = await POST(makeRequest("challenge", {}), {
			params: Promise.resolve({ action: "challenge" }),
		});
		expect(res.status).toBe(400);
		expect(postRawMock).not.toHaveBeenCalled();
		const body = (await res.json()) as { error: string };
		expect(body.error).toBe("missing_client_ip");
	});

	it("forwards Cap-native JSON through postRaw", async () => {
		postRawMock.mockResolvedValue(
			new Response(JSON.stringify({ success: true, token: "redeemed" }), { status: 200 }),
		);
		const { POST } = await import("@/app/api/v1/cap/[action]/route");
		const payload = { token: "chal", solutions: [1, 2] };
		const res = await POST(makeRequest("redeem", payload, { "cf-connecting-ip": "198.51.100.7" }), {
			params: Promise.resolve({ action: "redeem" }),
		});
		expect(res.status).toBe(200);
		expect(postRawMock).toHaveBeenCalledWith("/api/v1/cap/redeem", payload, {
			ip: "198.51.100.7",
			userAgent: undefined,
		});
		expect(await res.json()).toEqual({ success: true, token: "redeemed" });
	});
});
