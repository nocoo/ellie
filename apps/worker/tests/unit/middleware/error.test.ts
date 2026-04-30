import { describe, expect, it } from "vitest";
import { errorResponse } from "../../../src/middleware/error";

describe("errorResponse", () => {
	it("should return JSON error body with code and message", async () => {
		const response = errorResponse("INVALID_REQUEST", 400);

		expect(response.status).toBe(400);
		const data = await response.json();
		expect(data.error.code).toBe("INVALID_REQUEST");
		expect(data.error.message).toBe("Invalid request parameters");
	});

	it("should include details when provided", async () => {
		const response = errorResponse("INVALID_REQUEST", 400, {
			field: "username",
		});

		const data = await response.json();
		expect(data.error.details).toEqual({ field: "username" });
	});

	it("should not include details when undefined", async () => {
		const response = errorResponse("NOT_FOUND", 404);

		const data = await response.json();
		expect(data.error.details).toBeUndefined();
	});

	it("should include CORS headers when origin is provided", () => {
		const response = errorResponse("NOT_FOUND", 404, undefined, "https://ellie.nocoo.cloud");

		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
			"GET, POST, PATCH, DELETE, OPTIONS",
		);
	});

	it("should include base CORS headers without origin", () => {
		const response = errorResponse("NOT_FOUND", 404);

		// Should still have methods/headers but NOT Allow-Origin
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
			"GET, POST, PATCH, DELETE, OPTIONS",
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("should not set Allow-Origin for disallowed origins", () => {
		const response = errorResponse("NOT_FOUND", 404, undefined, "https://evil.com");

		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("should always include Content-Type application/json", () => {
		const response = errorResponse("INTERNAL_ERROR", 500);

		expect(response.headers.get("Content-Type")).toBe("application/json");
	});

	it("should return fallback message for unknown codes", async () => {
		const response = errorResponse("UNKNOWN_CODE", 500);

		const data = await response.json();
		expect(data.error.message).toBe("An error occurred");
	});

	it("should map all known error codes to messages", async () => {
		const codes = [
			"INVALID_REQUEST",
			"UNAUTHORIZED",
			"FORBIDDEN",
			"NOT_FOUND",
			"RATE_LIMITED",
			"INTERNAL_ERROR",
			"INVALID_CREDENTIALS",
			"USER_BANNED",
			"TOKEN_EXPIRED",
			"INVALID_TOKEN",
			"FORBIDDEN_ADMIN_ONLY",
		];

		for (const code of codes) {
			const response = errorResponse(code, 400);
			const data = await response.json();
			expect(data.error.message).not.toBe("An error occurred");
		}
	});
});
