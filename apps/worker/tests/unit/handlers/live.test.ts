import { describe, expect, it, mock } from "bun:test";
import { live } from "../../../src/handlers/live";
import type { Env } from "../../../src/lib/env";
import { createMockKV } from "../../helpers";

describe("live handler", () => {
	const baseEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: createMockKV(),
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

		it("should include database.connected true", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.database.connected).toBe(true);
		});

		it("should include component field as ellie-worker", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.component).toBe("ellie-worker");
		});

		it("should include ISO 8601 timestamp", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.timestamp).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
			);
		});

		it("should include uptime as a number", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(typeof data.uptime).toBe("number");
			expect(data.uptime).toBeGreaterThanOrEqual(0);
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
				"Content-Type, Authorization, X-API-Key",
			);
		});

		it("should set Access-Control-Allow-Origin for allowed origin", async () => {
			const req = new Request("https://example.com/api/live", {
				headers: { Origin: "https://ellie.nocoo.cloud" },
			});
			const response = await live(req, env);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
				"https://ellie.nocoo.cloud",
			);
		});

		it("should not set Access-Control-Allow-Origin for disallowed origin", async () => {
			const req = new Request("https://example.com/api/live", {
				headers: { Origin: "https://evil.com" },
			});
			const response = await live(req, env);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

		it("should include database.connected false with error", async () => {
			const response = await live(makeRequest(), env);
			const data = await response.json();

			expect(data.database.connected).toBe(false);
			expect(data.database.error).toContain("D1 connection failed");
		});

		it("should NOT contain 'ok' anywhere in error response body (monitor safety)", async () => {
			const response = await live(makeRequest(), env);
			const text = await response.text();

			const parsed = JSON.parse(text);
			expect(parsed.status).toBe("error");

			// Check that no value in the response body contains standalone "ok"
			const bodyWithoutStatus = { ...parsed };
			bodyWithoutStatus.status = undefined;
			const remainingText = JSON.stringify(bodyWithoutStatus);
			expect(remainingText).not.toContain('"ok"');
		});

		it("should strip 'ok' from error messages that contain it", async () => {
			const dbWithOkInError = {
				prepare: mock(() => ({
					first: mock(
						() =>
							Promise.reject(new Error("connection ok but data broken")),
					),
				})),
			} as unknown as D1Database;

			const response = await live(makeRequest(), {
				...baseEnv,
				DB: dbWithOkInError,
			});
			const data = await response.json();

			// "ok" in error message should be replaced to prevent monitor confusion
			expect(data.database.error).not.toMatch(/\bok\b/i);
			expect(data.database.error).toContain("***");
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

		it("should set Access-Control-Allow-Origin on error for allowed origin", async () => {
			const req = new Request("https://example.com/api/live", {
				headers: { Origin: "http://localhost:3000" },
			});
			const response = await live(req, env);

			expect(response.status).toBe(503);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
				"http://localhost:3000",
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
			expect(data.database.connected).toBe(false);
			expect(data.database.error).toContain("string error");
		});
	});
});
