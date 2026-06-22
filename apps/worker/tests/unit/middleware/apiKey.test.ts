import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/lib/env";
import { validateApiKey } from "../../../src/middleware/apiKey";
import { createMockKV } from "../../helpers";

describe("validateApiKey", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key-abc123",
		ADMIN_API_KEY: "test-admin-key-xyz789",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: createMockKV(),
	};

	// ── Key A for /api/v1/* ──────────────────────────────

	it("should return null (pass) when Key A matches for /api/v1/* route", () => {
		const request = new Request("https://example.com/api/v1/forums", {
			headers: { "X-API-Key": "test-api-key-abc123" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeNull();
	});

	it("should return 401 when Key B is used for /api/v1/* route", async () => {
		const request = new Request("https://example.com/api/v1/forums", {
			headers: { "X-API-Key": "test-admin-key-xyz789" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	// ── Key B for /api/admin/* ───────────────────────────

	it("should return null (pass) when Key B matches for /api/admin/* route", () => {
		const request = new Request("https://example.com/api/admin/users", {
			headers: { "X-API-Key": "test-admin-key-xyz789" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeNull();
	});

	it("should return 401 when Key A is used for /api/admin/* route", async () => {
		const request = new Request("https://example.com/api/admin/users", {
			headers: { "X-API-Key": "test-api-key-abc123" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	// ── Missing / wrong key ──────────────────────────────

	it("should return 401 when X-API-Key is missing", async () => {
		const request = new Request("https://example.com/api/v1/forums");

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);

		const data = await result?.json();
		expect(data.error.code).toBe("UNAUTHORIZED");
		expect(data.error.message).toBe("Authentication required");
	});

	it("should return 401 when X-API-Key is wrong for /api/v1/*", async () => {
		const request = new Request("https://example.com/api/v1/forums", {
			headers: { "X-API-Key": "wrong-key" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	it("should return 401 when X-API-Key is wrong for /api/admin/*", async () => {
		const request = new Request("https://example.com/api/admin/forums", {
			headers: { "X-API-Key": "wrong-key" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	it("should return 401 when X-API-Key is empty string", async () => {
		const request = new Request("https://example.com/api/v1/forums", {
			headers: { "X-API-Key": "" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	// ── CORS headers ─────────────────────────────────────

	it("should include CORS headers when origin is provided", () => {
		const request = new Request("https://example.com/api/v1/forums");

		const result = validateApiKey(request, mockEnv, "https://ellie.nocoo.cloud");
		expect(result).toBeInstanceOf(Response);
		expect(result?.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
	});

	it("should not set Allow-Origin for disallowed origin", () => {
		const request = new Request("https://example.com/api/v1/forums");

		const result = validateApiKey(request, mockEnv, "https://evil.com");
		expect(result).toBeInstanceOf(Response);
		expect(result?.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("should return JSON Content-Type on 401", () => {
		const request = new Request("https://example.com/api/v1/forums");

		const result = validateApiKey(request, mockEnv);
		expect(result?.headers.get("Content-Type")).toBe("application/json");
	});

	// ── Explicit allowlist / fail-closed default ─────────
	//
	// Paths outside `/api/v1/` and `/api/admin/` must NOT fall through to
	// the Key-A branch. Any non-prefixed path is rejected with 401 even
	// when the caller presents a valid Key A or Key B. This guards against
	// a future router/proxy change exposing a non-prefixed path from
	// silently inheriting Key-A semantics (CVE-2026-29045 style desync).

	it("should return 401 for paths outside /api/v1/ and /api/admin/ even with valid Key A", async () => {
		const request = new Request("https://example.com/foo/bar", {
			headers: { "X-API-Key": "test-api-key-abc123" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	it("should return 401 for paths outside /api/v1/ and /api/admin/ even with valid Key B", async () => {
		const request = new Request("https://example.com/foo/bar", {
			headers: { "X-API-Key": "test-admin-key-xyz789" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	it("should return 401 for root path /", () => {
		const request = new Request("https://example.com/", {
			headers: { "X-API-Key": "test-api-key-abc123" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	it("should return 401 for /api/admin (no trailing slash, not a prefix match)", () => {
		// "/api/admin" must NOT be treated as the admin prefix — the prefix
		// is "/api/admin/" (with the slash). Without it, this path is just
		// another non-allowlisted route and must be rejected fail-closed.
		const request = new Request("https://example.com/api/admin", {
			headers: { "X-API-Key": "test-admin-key-xyz789" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});

	it("should return 401 for /api/v1 (no trailing slash, not a prefix match)", () => {
		const request = new Request("https://example.com/api/v1", {
			headers: { "X-API-Key": "test-api-key-abc123" },
		});

		const result = validateApiKey(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect(result?.status).toBe(401);
	});
});
