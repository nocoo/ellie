import { ApiError } from "@ellie/shared";
import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "@/lib/admin-error";

describe("extractErrorMessage", () => {
	it("uses ApiError.message", () => {
		const err = new ApiError(400, { code: "USERNAME_TAKEN", message: "Username already exists" });
		expect(extractErrorMessage(err)).toBe("Username already exists");
	});

	it("falls back to ApiError.code when message is empty", () => {
		const err = new ApiError(409, { code: "FORUM_HAS_THREADS", message: "" });
		expect(extractErrorMessage(err)).toBe("FORUM_HAS_THREADS");
	});

	it("uses Error.message for native errors", () => {
		expect(extractErrorMessage(new Error("Network down"))).toBe("Network down");
	});

	it("uses fallback when Error message is empty", () => {
		expect(extractErrorMessage(new Error(""), "default")).toBe("default");
	});

	it("uses fallback for unknown values", () => {
		expect(extractErrorMessage("oops", "default")).toBe("default");
		expect(extractErrorMessage(null, "default")).toBe("default");
		expect(extractErrorMessage(undefined, "default")).toBe("default");
	});

	it("default fallback is a Chinese sentence", () => {
		expect(extractErrorMessage(null)).toBe("操作失败，请稍后重试");
	});
});
