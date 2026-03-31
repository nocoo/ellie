import { describe, expect, it } from "bun:test";
import {
	canSubmitRegister,
	passwordStrength,
	registerErrorMessage,
	validateEmail,
	validateUsername,
} from "../../../../apps/web/src/viewmodels/forum/register";

// ---------------------------------------------------------------------------
// validateUsername
// ---------------------------------------------------------------------------

describe("validateUsername", () => {
	it("returns error for empty string", () => {
		expect(validateUsername("")).not.toBeNull();
	});

	it("returns error for whitespace-only string", () => {
		expect(validateUsername("   ")).not.toBeNull();
	});

	it("returns error for 1-char string", () => {
		expect(validateUsername("a")).not.toBeNull();
	});

	it("returns null for 2-char valid string", () => {
		expect(validateUsername("ab")).toBeNull();
	});

	it("returns null for 15-char valid string", () => {
		expect(validateUsername("a".repeat(15))).toBeNull();
	});

	it("returns error for 16-char string", () => {
		expect(validateUsername("a".repeat(16))).not.toBeNull();
	});

	it("allows Chinese characters", () => {
		expect(validateUsername("测试用户")).toBeNull();
	});

	it("allows mixed Chinese/English/digits/underscore", () => {
		expect(validateUsername("测试user_123")).toBeNull();
	});

	it("rejects special characters (@)", () => {
		expect(validateUsername("user@name")).not.toBeNull();
	});

	it("rejects special characters (!)", () => {
		expect(validateUsername("user!name")).not.toBeNull();
	});

	it("rejects spaces in middle", () => {
		expect(validateUsername("user name")).not.toBeNull();
	});

	it("trims whitespace before validation", () => {
		expect(validateUsername(" ab ")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// passwordStrength
// ---------------------------------------------------------------------------

describe("passwordStrength", () => {
	it("returns none for < 6 chars", () => {
		expect(passwordStrength("12345")).toBe("none");
	});

	it("returns none for empty", () => {
		expect(passwordStrength("")).toBe("none");
	});

	it("returns weak for 6-7 chars", () => {
		expect(passwordStrength("123456")).toBe("weak");
		expect(passwordStrength("1234567")).toBe("weak");
	});

	it("returns medium for 8-11 chars without variety", () => {
		expect(passwordStrength("12345678")).toBe("medium");
		expect(passwordStrength("abcdefghij")).toBe("medium");
	});

	it("returns strong for >= 12 chars", () => {
		expect(passwordStrength("123456789012")).toBe("strong");
	});

	it("returns strong for 8+ chars with 3+ character types", () => {
		expect(passwordStrength("Abc123!@")).toBe("strong"); // lower + upper + digit + special
		expect(passwordStrength("Abc12345")).toBe("strong"); // lower + upper + digit
	});
});

// ---------------------------------------------------------------------------
// validateEmail
// ---------------------------------------------------------------------------

describe("validateEmail", () => {
	it("returns null for empty (optional)", () => {
		expect(validateEmail("")).toBeNull();
	});

	it("returns null for valid email", () => {
		expect(validateEmail("user@example.com")).toBeNull();
	});

	it("returns error for invalid email", () => {
		expect(validateEmail("not-an-email")).not.toBeNull();
		expect(validateEmail("missing@domain")).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// canSubmitRegister
// ---------------------------------------------------------------------------

describe("canSubmitRegister", () => {
	it("returns true when all fields valid", () => {
		expect(
			canSubmitRegister({
				username: "validuser",
				password: "123456",
				confirmPassword: "123456",
				email: "",
			}),
		).toBe(true);
	});

	it("returns false when username invalid", () => {
		expect(
			canSubmitRegister({
				username: "a",
				password: "123456",
				confirmPassword: "123456",
				email: "",
			}),
		).toBe(false);
	});

	it("returns false when password too short", () => {
		expect(
			canSubmitRegister({
				username: "validuser",
				password: "12345",
				confirmPassword: "12345",
				email: "",
			}),
		).toBe(false);
	});

	it("returns false when passwords don't match", () => {
		expect(
			canSubmitRegister({
				username: "validuser",
				password: "123456",
				confirmPassword: "654321",
				email: "",
			}),
		).toBe(false);
	});

	it("returns true when email is empty (optional)", () => {
		expect(
			canSubmitRegister({
				username: "validuser",
				password: "123456",
				confirmPassword: "123456",
				email: "",
			}),
		).toBe(true);
	});

	it("returns false when email is invalid format", () => {
		expect(
			canSubmitRegister({
				username: "validuser",
				password: "123456",
				confirmPassword: "123456",
				email: "not-email",
			}),
		).toBe(false);
	});

	it("returns true when email is valid", () => {
		expect(
			canSubmitRegister({
				username: "validuser",
				password: "123456",
				confirmPassword: "123456",
				email: "user@example.com",
			}),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// registerErrorMessage
// ---------------------------------------------------------------------------

describe("registerErrorMessage", () => {
	it("returns null for null input", () => {
		expect(registerErrorMessage(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(registerErrorMessage(undefined)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(registerErrorMessage("")).toBeNull();
	});

	it("maps USERNAME_TAKEN to Chinese message", () => {
		expect(registerErrorMessage("USERNAME_TAKEN")).toBe("该用户名已被注册");
	});

	it("maps USERNAME_BANNED to Chinese message", () => {
		expect(registerErrorMessage("USERNAME_BANNED")).toBe("用户名包含违禁词");
	});

	it("maps RATE_LIMITED to Chinese message", () => {
		expect(registerErrorMessage("RATE_LIMITED")).toBe("注册太频繁，请稍后再试");
	});

	it("maps unknown code to generic message", () => {
		expect(registerErrorMessage("SOMETHING_UNKNOWN")).toBe("注册失败，请重试");
	});
});
