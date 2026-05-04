// purge-route.test.ts — F1 wiring test: confirm the purge route still
// forwards the X-Admin-Actor-Email / X-Admin-Actor-Name headers to the
// Worker after switching to adminApiAs(admin). We stub global fetch and
// assert on the headers actually being sent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin", () => ({ resolveAdmin: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
	validateOrigin: vi.fn(() => true),
	getAllowedOrigins: vi.fn(() => ["http://localhost:3000"]),
}));

import { POST } from "@/app/api/admin/users/[id]/purge/route";
import { auth } from "@/auth";
import { resolveAdmin } from "@/lib/admin";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockResolveAdmin = resolveAdmin as ReturnType<typeof vi.fn>;

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
let mockFetchFn: ReturnType<typeof vi.fn>;

beforeEach(() => {
	process.env.WORKER_API_URL = "https://worker.example.com";
	process.env.ADMIN_API_KEY = "test-key";
	mockFetchFn = vi.fn(() =>
		Promise.resolve(
			new Response(JSON.stringify({ data: { purged: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as never;
	mockAuth.mockResolvedValue({ user: { email: "alice@example.com", name: "Alice" } });
	mockResolveAdmin.mockReturnValue({ sub: "1", email: "alice@example.com", name: "Alice" });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
});

describe("admin purge route — F1 actor wiring", () => {
	it("forwards X-Admin-Actor-Email/Name through adminApiAs", async () => {
		const req = new Request("http://localhost/api/admin/users/42/purge", {
			method: "POST",
			headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
			body: JSON.stringify({ confirmUsername: "deleted-user" }),
		}) as never;
		const ctx = { params: Promise.resolve({ id: "42" }) };
		const res = await POST(req, ctx);
		expect(res.status).toBe(200);
		expect(mockFetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/purge");
		const headers = opts.headers as Record<string, string>;
		expect(headers["X-Admin-Actor-Email"]).toBe("alice@example.com");
		expect(headers["X-Admin-Actor-Name"]).toBe("Alice");
		expect(headers["X-API-Key"]).toBe("test-key");
		expect(opts.body).toBe(JSON.stringify({ confirmUsername: "deleted-user" }));
	});
});
