// checkin-routes.test.ts — Phase F BFF wiring. Confirms the three new
// proxy routes forward to the worker with the correct method, path,
// query string, and body, and surface the worker response unchanged.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/admin", () => ({ resolveAdmin: vi.fn() }));
vi.mock("@/lib/csrf", () => ({
	validateOrigin: vi.fn(() => true),
	getAllowedOrigins: vi.fn(() => ["http://localhost:3000"]),
}));

import { PATCH as PATCH_DAY } from "@/app/api/admin/users/[id]/checkins/[dateLocal]/route";
import { GET as GET_LIST } from "@/app/api/admin/users/[id]/checkins/route";
import { PATCH as PATCH_STREAK } from "@/app/api/admin/users/[id]/checkins/streak/route";
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
			new Response(JSON.stringify({ data: { ok: true } }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		),
	);
	globalThis.fetch = mockFetchFn as never;
	mockAuth.mockResolvedValue({ user: { email: "a@e.com", name: "Admin" } });
	mockResolveAdmin.mockReturnValue({ sub: "1", email: "a@e.com", name: "Admin" });
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
	process.env.ADMIN_API_KEY = originalEnv.ADMIN_API_KEY;
});

describe("admin checkin BFF routes", () => {
	it("GET forwards path without query when none provided", async () => {
		const req = new Request("http://localhost/api/admin/users/42/checkins") as never;
		const ctx = { params: Promise.resolve({ id: "42" }) };
		const res = await GET_LIST(req, ctx);
		expect(res.status).toBe(200);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toMatch(/\/api\/admin\/users\/42\/checkins$/);
		expect(opts.method).toBe("GET");
	});

	it("GET forwards from/to query string to the worker", async () => {
		const req = new Request(
			"http://localhost/api/admin/users/42/checkins?from=2026-04-01&to=2026-05-12",
		) as never;
		const ctx = { params: Promise.resolve({ id: "42" }) };
		await GET_LIST(req, ctx);
		const [url] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/checkins?from=2026-04-01&to=2026-05-12");
	});

	it("PATCH dateLocal forwards body and method", async () => {
		const req = new Request("http://localhost/api/admin/users/42/checkins/2026-05-12", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
			body: JSON.stringify({ checkedIn: true }),
		}) as never;
		const ctx = { params: Promise.resolve({ id: "42", dateLocal: "2026-05-12" }) };
		const res = await PATCH_DAY(req, ctx);
		expect(res.status).toBe(200);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/checkins/2026-05-12");
		expect(opts.method).toBe("PATCH");
		expect(opts.body).toBe(JSON.stringify({ checkedIn: true }));
	});

	it("PATCH streak forwards body and method", async () => {
		const req = new Request("http://localhost/api/admin/users/42/checkins/streak", {
			method: "PATCH",
			headers: { "Content-Type": "application/json", origin: "http://localhost:3000" },
			body: JSON.stringify({ streakDays: 7 }),
		}) as never;
		const ctx = { params: Promise.resolve({ id: "42" }) };
		const res = await PATCH_STREAK(req, ctx);
		expect(res.status).toBe(200);
		const [url, opts] = mockFetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/admin/users/42/checkins/streak");
		expect(opts.method).toBe("PATCH");
		expect(opts.body).toBe(JSON.stringify({ streakDays: 7 }));
	});
});
