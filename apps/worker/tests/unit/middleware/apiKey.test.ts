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
});
