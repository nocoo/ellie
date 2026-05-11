import {
	REGISTER_PROFILE_DEFAULTS,
	buildRegisterProfile,
	canSubmitRegister,
	passwordStrength,
	registerErrorMessage,
	validateEmail,
	validateUsername,
} from "@/viewmodels/forum/register";
import { describe, expect, it } from "vitest";

/** Shorthand: merge auth fields with profile defaults for canSubmitRegister */
function regState(auth: {
	username: string;
	password: string;
	confirmPassword: string;
	email: string;
}) {
	return { ...auth, ...REGISTER_PROFILE_DEFAULTS };
}

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
	it("returns error for empty (email is required)", () => {
		expect(validateEmail("")).not.toBeNull();
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
	it("returns false when username invalid", () => {
		expect(
			canSubmitRegister(
				regState({
					username: "a",
					password: "123456",
					confirmPassword: "123456",
					email: "u@e.com",
				}),
			),
		).toBe(false);
	});

	it("returns false when password too short", () => {
		expect(
			canSubmitRegister(
				regState({
					username: "validuser",
					password: "12345",
					confirmPassword: "12345",
					email: "u@e.com",
				}),
			),
		).toBe(false);
	});

	it("returns false when passwords don't match", () => {
		expect(
			canSubmitRegister(
				regState({
					username: "validuser",
					password: "123456",
					confirmPassword: "654321",
					email: "u@e.com",
				}),
			),
		).toBe(false);
	});

	it("returns false when email is empty (email is required)", () => {
		expect(
			canSubmitRegister(
				regState({
					username: "validuser",
					password: "123456",
					confirmPassword: "123456",
					email: "",
				}),
			),
		).toBe(false);
	});

	it("returns false when email is invalid format", () => {
		expect(
			canSubmitRegister(
				regState({
					username: "validuser",
					password: "123456",
					confirmPassword: "123456",
					email: "not-email",
				}),
			),
		).toBe(false);
	});

	it("returns true when all fields valid", () => {
		expect(
			canSubmitRegister(
				regState({
					username: "validuser",
					password: "123456",
					confirmPassword: "123456",
					email: "user@example.com",
				}),
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildRegisterProfile
// ---------------------------------------------------------------------------

describe("buildRegisterProfile", () => {
	it("returns undefined when all fields are defaults", () => {
		const state = regState({
			username: "u",
			password: "123456",
			confirmPassword: "123456",
			email: "u@e.com",
		});
		expect(buildRegisterProfile(state)).toBeUndefined();
	});

	it("includes gender when non-zero", () => {
		const state = {
			...regState({ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" }),
			gender: 1,
		};
		expect(buildRegisterProfile(state)).toEqual({ gender: 1 });
	});

	it("includes campus when non-empty", () => {
		const state = {
			...regState({ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" }),
			campus: " 同济大学 ",
		};
		expect(buildRegisterProfile(state)).toEqual({ campus: "同济大学" });
	});

	it("includes numeric birthday fields", () => {
		const state = {
			...regState({ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" }),
			birthYear: "1990",
			birthMonth: "6",
			birthDay: "15",
		};
		const profile = buildRegisterProfile(state);
		expect(profile).toEqual({ birthYear: 1990, birthMonth: 6, birthDay: 15 });
	});

	it("ignores non-numeric birthday strings", () => {
		const state = {
			...regState({ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" }),
			birthYear: "abc",
			birthMonth: "",
			birthDay: "",
		};
		expect(buildRegisterProfile(state)).toBeUndefined();
	});

	it("includes multiple string fields trimmed", () => {
		const state = {
			...regState({ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" }),
			bio: " Hello ",
			qq: "12345",
			site: "https://example.com",
		};
		expect(buildRegisterProfile(state)).toEqual({
			bio: "Hello",
			qq: "12345",
			site: "https://example.com",
		});
	});

	it("excludes fields that are empty strings", () => {
		const state = {
			...regState({ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" }),
			bio: "",
			interest: "   ",
		};
		expect(buildRegisterProfile(state)).toBeUndefined();
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
