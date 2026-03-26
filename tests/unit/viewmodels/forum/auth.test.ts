import { describe, expect, test } from "bun:test";
import { canLogin, getAuthErrorMessage, getRedirectUrl } from "@/viewmodels/forum/auth";

describe("auth ViewModel", () => {
	describe("canLogin", () => {
		test("valid credentials", () => {
			expect(canLogin("admin", "password")).toBe(true);
		});

		test("empty username", () => {
			expect(canLogin("", "password")).toBe(false);
		});

		test("empty password", () => {
			expect(canLogin("admin", "")).toBe(false);
		});

		test("whitespace-only username", () => {
			expect(canLogin("   ", "password")).toBe(false);
		});

		test("both empty", () => {
			expect(canLogin("", "")).toBe(false);
		});
	});

	describe("getAuthErrorMessage", () => {
		test("null for no error", () => {
			expect(getAuthErrorMessage(null)).toBeNull();
		});

		test("maps CredentialsSignin", () => {
			expect(getAuthErrorMessage("CredentialsSignin")).toBe("Invalid username or password");
		});

		test("maps AccessDenied", () => {
			expect(getAuthErrorMessage("AccessDenied")).toBe("Your account has been banned");
		});

		test("maps unknown error", () => {
			expect(getAuthErrorMessage("SomeError")).toBe("An error occurred during login");
		});
	});

	describe("getRedirectUrl", () => {
		test("returns / for null", () => {
			expect(getRedirectUrl(null)).toBe("/");
		});

		test("returns relative URL as-is", () => {
			expect(getRedirectUrl("/forums/1")).toBe("/forums/1");
		});

		test("prevents open redirect (absolute URL)", () => {
			expect(getRedirectUrl("https://evil.com")).toBe("/");
		});

		test("prevents open redirect (protocol-relative)", () => {
			expect(getRedirectUrl("//evil.com")).toBe("/");
		});

		test("allows root path", () => {
			expect(getRedirectUrl("/")).toBe("/");
		});
	});
});
