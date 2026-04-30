import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api-error";

describe("ApiError", () => {
	describe("structured constructor (data object)", () => {
		it("creates error with code, message, and details", () => {
			const err = new ApiError(400, {
				code: "VALIDATION_ERROR",
				message: "Invalid input",
				details: { field: "email" },
			});
			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(ApiError);
			expect(err.name).toBe("ApiError");
			expect(err.status).toBe(400);
			expect(err.code).toBe("VALIDATION_ERROR");
			expect(err.message).toBe("Invalid input");
			expect(err.details).toEqual({ field: "email" });
		});

		it("creates error without details", () => {
			const err = new ApiError(404, {
				code: "NOT_FOUND",
				message: "Resource not found",
			});
			expect(err.status).toBe(404);
			expect(err.code).toBe("NOT_FOUND");
			expect(err.message).toBe("Resource not found");
			expect(err.details).toBeUndefined();
		});
	});

	describe("flat constructor (code, message)", () => {
		it("creates error with separate code and message", () => {
			const err = new ApiError(500, "INTERNAL_ERROR", "Something broke");
			expect(err.status).toBe(500);
			expect(err.code).toBe("INTERNAL_ERROR");
			expect(err.message).toBe("Something broke");
			expect(err.details).toBeUndefined();
		});

		it("falls back to code as message when message is undefined", () => {
			// The ?? fallback in `super(message ?? dataOrCode)` fires when
			// message is undefined. We bypass the overload signature to test
			// the runtime branch directly.
			const err = new (ApiError as unknown as new (s: number, c: string, m?: string) => ApiError)(
				403,
				"FORBIDDEN",
			);
			expect(err.message).toBe("FORBIDDEN");
			expect(err.code).toBe("FORBIDDEN");
		});

		it("uses provided message over code", () => {
			const err = new ApiError(403, "FORBIDDEN", "Access denied");
			expect(err.message).toBe("Access denied");
			expect(err.code).toBe("FORBIDDEN");
		});
	});

	describe("error properties", () => {
		it("has name set to ApiError", () => {
			const err = new ApiError(401, { code: "UNAUTHORIZED", message: "No token" });
			expect(err.name).toBe("ApiError");
		});

		it("is throwable and catchable", () => {
			expect(() => {
				throw new ApiError(422, { code: "UNPROCESSABLE", message: "Bad data" });
			}).toThrow(ApiError);
		});

		it("status is readonly", () => {
			const err = new ApiError(500, "ERR", "fail");
			expect(err.status).toBe(500);
		});
	});
});
