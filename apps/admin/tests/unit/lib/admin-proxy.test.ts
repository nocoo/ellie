import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin", () => ({
	resolveAdmin: vi.fn(),
}));
vi.mock("@/lib/csrf", () => ({
	validateOrigin: vi.fn(),
	getAllowedOrigins: vi.fn(() => ["http://localhost:3000"]),
}));
vi.mock("@/lib/admin-api", () => ({
	adminApi: { raw: vi.fn() },
}));

import { auth } from "@/auth";
import { resolveAdmin } from "@/lib/admin";
import { createProxyHandler, passthrough } from "@/lib/admin-proxy";
import { validateOrigin } from "@/lib/csrf";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockResolveAdmin = resolveAdmin as ReturnType<typeof vi.fn>;
const mockValidateOrigin = validateOrigin as ReturnType<typeof vi.fn>;

describe("admin-proxy", () => {
	describe("createProxyHandler", () => {
		const handler = vi.fn(async () => new Response("ok"));
		const route = createProxyHandler(handler);
		const context = { params: Promise.resolve({}) };

		it("rejects mutating request with invalid CSRF", async () => {
			mockValidateOrigin.mockReturnValue(false);
			const req = new Request("http://localhost/api", { method: "POST" }) as any;
			const res = await route(req, context);
			expect(res.status).toBe(403);
			const body = await res.json();
			expect(body.error.code).toBe("CSRF_REJECTED");
		});

		it("allows GET without CSRF check", async () => {
			mockValidateOrigin.mockClear();
			mockAuth.mockResolvedValue({ user: { email: "a@x.com" } });
			mockResolveAdmin.mockReturnValue({ sub: "1", email: "a@x.com", name: "A" });
			handler.mockClear();
			const req = new Request("http://localhost/api", { method: "GET" }) as any;
			await route(req, context);
			expect(mockValidateOrigin).not.toHaveBeenCalled();
			expect(handler).toHaveBeenCalled();
		});

		it("rejects unauthenticated request", async () => {
			mockValidateOrigin.mockReturnValue(true);
			mockAuth.mockResolvedValue(null);
			mockResolveAdmin.mockReturnValue(null);
			const req = new Request("http://localhost/api", { method: "POST" }) as any;
			const res = await route(req, context);
			expect(res.status).toBe(401);
		});

		it("calls handler when auth passes", async () => {
			mockValidateOrigin.mockReturnValue(true);
			mockAuth.mockResolvedValue({ user: { email: "a@x.com" } });
			mockResolveAdmin.mockReturnValue({ sub: "1", email: "a@x.com", name: "A" });
			handler.mockClear();
			const req = new Request("http://localhost/api", { method: "POST" }) as any;
			await route(req, context);
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe("passthrough", () => {
		it("forwards status and body", async () => {
			const workerRes = new Response(JSON.stringify({ data: "x" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			});
			const res = await passthrough(workerRes);
			expect(res.status).toBe(201);
			const text = await res.text();
			expect(text).toContain('"data":"x"');
		});

		it("defaults content type to application/json when absent", async () => {
			const workerRes = new Response(null, { status: 200 });
			// Remove auto-set content-type to trigger fallback
			workerRes.headers.delete("Content-Type");
			const res = await passthrough(workerRes);
			expect(res.headers.get("Content-Type")).toBe("application/json");
		});
	});
});
