import { describe, expect, it, mock } from "bun:test";
import { live } from "../../../src/handlers/live";
import type { Env } from "../../../src/lib/env";

describe("live handler", () => {
	const baseEnv: Env = {
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
		RATE_LIMITER: {} as DurableObjectNamespace,
	};

	const makeRequest = () => new Request("https://example.com/api/live");

	describe("when D1 is healthy", () => {
		const healthyDb = {
			prepare: mock(() => ({
				first: mock(() => Promise.resolve({ probe: 1 })),
			})),
		} as unknown as D1Database;

		const env = { ...baseEnv, DB: healthyDb };

		it("should return 200 with status ok", async () => {
			const response = await live(makeRequest(), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.status).toBe("ok");
		});

		it("should include d1 connected in checks", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.checks.d1).toBe("connected");
		});

		it("should include environment field", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.environment).toBe("test");
		});

		it("should include timestamp field", async () => {
			const before = Date.now();
			const response = await live(makeRequest(), env);
			const data = await response.json();
			const after = Date.now();

			expect(data.timestamp).toBeGreaterThanOrEqual(before);
			expect(data.timestamp).toBeLessThanOrEqual(after);
		});

		it("should return Cache-Control: no-store", async () => {
			const response = await live(makeRequest(), env);

			expect(response.headers.get("Cache-Control")).toBe("no-store");
		});

		it("should return Content-Type: application/json", async () => {
			const response = await live(makeRequest(), env);

			expect(response.headers.get("Content-Type")).toBe("application/json");
		});

		it("should include CORS headers", async () => {
			const response = await live(makeRequest(), env);

			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
			expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
				"Content-Type, Authorization",
			);
		});

		it("should probe D1 with SELECT 1", async () => {
			const firstSpy = mock(() => Promise.resolve({ probe: 1 }));
			const prepareSpy = mock(() => ({ first: firstSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;

			await live(makeRequest(), { ...baseEnv, DB: db });

			expect(prepareSpy).toHaveBeenCalledWith("SELECT 1 AS probe");
			expect(firstSpy).toHaveBeenCalled();
		});
	});

	describe("when D1 is down", () => {
		const brokenDb = {
			prepare: mock(() => ({
				first: mock(() => Promise.reject(new Error("D1 connection failed"))),
			})),
		} as unknown as D1Database;

		const env = { ...baseEnv, DB: brokenDb };

		it("should return 503 with status error", async () => {
			const response = await live(makeRequest(), env);

			expect(response.status).toBe(503);
			const data = await response.json();
			expect(data.status).toBe("error");
		});

		it("should include error details in checks.d1", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.checks.d1).toContain("unreachable:");
			expect(data.checks.d1).toContain("D1 connection failed");
		});

		it("should NOT contain 'ok' anywhere in error response body (monitor safety)", async () => {
			const response = await live(makeRequest(), env);
			const text = await response.text();

			// The word "ok" should not appear in the response when status is error
			// to prevent keyword-based monitors from false-positive matching
			const parsed = JSON.parse(text);
			expect(parsed.status).toBe("error");

			// Check that no value in the response body contains standalone "ok"
			// (status:"ok" would be a false positive for a keyword monitor)
			const bodyWithoutStatus = { ...parsed };
			bodyWithoutStatus.status = undefined;
			const remainingText = JSON.stringify(bodyWithoutStatus);
			expect(remainingText).not.toContain('"ok"');
		});

		it("should strip 'ok' from error messages that contain it", async () => {
			const dbWithOkInError = {
				prepare: mock(() => ({
					first: mock(() => Promise.reject(new Error("connection ok but data broken"))),
				})),
			} as unknown as D1Database;

			const response = await live(makeRequest(), { ...baseEnv, DB: dbWithOkInError });
			const data = await response.json();

			// "ok" in error message should be replaced to prevent monitor confusion
			expect(data.checks.d1).not.toMatch(/\bok\b/i);
			expect(data.checks.d1).toContain("***");
		});

		it("should still return Cache-Control: no-store on error", async () => {
			const response = await live(makeRequest(), env);

			expect(response.headers.get("Cache-Control")).toBe("no-store");
		});

		it("should still include CORS headers on error", async () => {
			const response = await live(makeRequest(), env);

			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		});
	});

	describe("when D1 throws non-Error", () => {
		const dbWithStringError = {
			prepare: mock(() => ({
				first: mock(() => Promise.reject("string error")),
			})),
		} as unknown as D1Database;

		const env = { ...baseEnv, DB: dbWithStringError };

		it("should handle non-Error throws gracefully", async () => {
			const response = await live(makeRequest(), env);

			expect(response.status).toBe(503);
			const data = await response.json();
			expect(data.status).toBe("error");
			expect(data.checks.d1).toContain("unreachable:");
			expect(data.checks.d1).toContain("string error");
		});
	});

	describe("environment field", () => {
		it("should reflect the ENVIRONMENT env var", async () => {
			const healthyDb = {
				prepare: mock(() => ({
					first: mock(() => Promise.resolve({ probe: 1 })),
				})),
			} as unknown as D1Database;

			const env = { ...baseEnv, DB: healthyDb, ENVIRONMENT: "production" };
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.environment).toBe("production");
		});
	});
});
