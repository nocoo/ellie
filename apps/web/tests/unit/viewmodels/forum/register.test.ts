import {
	REGISTER_PROFILE_DEFAULTS,
	buildRegisterProfile,
	canSubmitRegister,
	passwordStrength,
	registerErrorMessage,
	validateBirthday,
	validateEmail,
	validateQQ,
	validateSite,
	validateUsername,
} from "@/viewmodels/forum/register";
import { describe, expect, it } from "vitest";

/** Shorthand: merge auth + required education fields with profile defaults */
function regState(
	auth: {
		username: string;
		password: string;
		confirmPassword: string;
		email: string;
	},
	overrides: Partial<typeof REGISTER_PROFILE_DEFAULTS> = {},
) {
	return {
		...auth,
		...REGISTER_PROFILE_DEFAULTS,
		// Education fields required for canSubmitRegister
		graduateSchool: "校内人士",
		campus: "四平路校区",
		...overrides,
	};
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
// validateBirthday
// ---------------------------------------------------------------------------

describe("validateBirthday", () => {
	it("returns null when all empty (optional)", () => {
		expect(validateBirthday("", "", "")).toBeNull();
	});

	it("returns error for partial fill (year only)", () => {
		expect(validateBirthday("1990", "", "")).not.toBeNull();
	});

	it("returns error for partial fill (year + month only)", () => {
		expect(validateBirthday("1990", "6", "")).not.toBeNull();
	});

	it("returns error for partial fill (day only)", () => {
		expect(validateBirthday("", "", "15")).not.toBeNull();
	});

	it("returns null for valid complete date", () => {
		expect(validateBirthday("1990", "6", "15")).toBeNull();
	});

	it("returns error for non-numeric year", () => {
		expect(validateBirthday("abc", "6", "15")).not.toBeNull();
	});

	it("returns error for non-numeric month", () => {
		expect(validateBirthday("1990", "ab", "15")).not.toBeNull();
	});

	it("returns error for non-numeric day", () => {
		expect(validateBirthday("1990", "6", "xx")).not.toBeNull();
	});

	it("returns error for year before 1900", () => {
		expect(validateBirthday("1899", "1", "1")).not.toBeNull();
	});

	it("returns error for year in future", () => {
		const futureYear = String(new Date().getFullYear() + 1);
		expect(validateBirthday(futureYear, "1", "1")).not.toBeNull();
	});

	it("accepts current year", () => {
		const thisYear = String(new Date().getFullYear());
		expect(validateBirthday(thisYear, "1", "1")).toBeNull();
	});

	it("returns error for month 0", () => {
		expect(validateBirthday("1990", "0", "1")).not.toBeNull();
	});

	it("returns error for month 13", () => {
		expect(validateBirthday("1990", "13", "1")).not.toBeNull();
	});

	it("returns error for day 0", () => {
		expect(validateBirthday("1990", "1", "0")).not.toBeNull();
	});

	it("returns error for Feb 30", () => {
		expect(validateBirthday("1990", "2", "30")).not.toBeNull();
	});

	it("accepts Feb 29 in leap year (2000)", () => {
		expect(validateBirthday("2000", "2", "29")).toBeNull();
	});

	it("rejects Feb 29 in non-leap year (1999)", () => {
		expect(validateBirthday("1999", "2", "29")).not.toBeNull();
	});

	it("accepts Jan 31", () => {
		expect(validateBirthday("1990", "1", "31")).toBeNull();
	});

	it("rejects Apr 31", () => {
		expect(validateBirthday("1990", "4", "31")).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// validateQQ
// ---------------------------------------------------------------------------

describe("validateQQ", () => {
	it("returns null for empty (optional)", () => {
		expect(validateQQ("")).toBeNull();
	});

	it("returns null for valid QQ number", () => {
		expect(validateQQ("12345")).toBeNull();
		expect(validateQQ("123456789")).toBeNull();
	});

	it("returns error for non-numeric", () => {
		expect(validateQQ("abc123")).not.toBeNull();
	});

	it("returns error for too short (< 5 digits)", () => {
		expect(validateQQ("1234")).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// validateSite
// ---------------------------------------------------------------------------

describe("validateSite", () => {
	it("returns null for empty (optional)", () => {
		expect(validateSite("")).toBeNull();
	});

	it("returns null for valid https URL", () => {
		expect(validateSite("https://example.com")).toBeNull();
	});

	it("returns null for valid http URL", () => {
		expect(validateSite("http://example.com")).toBeNull();
	});

	it("returns error for non-URL string", () => {
		expect(validateSite("not-a-url")).not.toBeNull();
	});

	it("returns error for ftp protocol", () => {
		expect(validateSite("ftp://files.example.com")).not.toBeNull();
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

	it("returns false when graduateSchool is empty", () => {
		expect(
			canSubmitRegister(
				regState(
					{
						username: "validuser",
						password: "123456",
						confirmPassword: "123456",
						email: "u@e.com",
					},
					{ graduateSchool: "" },
				),
			),
		).toBe(false);
	});

	it("returns false when campus is empty", () => {
		expect(
			canSubmitRegister(
				regState(
					{
						username: "validuser",
						password: "123456",
						confirmPassword: "123456",
						email: "u@e.com",
					},
					{ campus: "" },
				),
			),
		).toBe(false);
	});

	it("returns false when birthday is partially filled", () => {
		expect(
			canSubmitRegister(
				regState(
					{
						username: "validuser",
						password: "123456",
						confirmPassword: "123456",
						email: "u@e.com",
					},
					{ birthYear: "1990", birthMonth: "", birthDay: "" },
				),
			),
		).toBe(false);
	});

	it("returns false when QQ is non-numeric", () => {
		expect(
			canSubmitRegister(
				regState(
					{
						username: "validuser",
						password: "123456",
						confirmPassword: "123456",
						email: "u@e.com",
					},
					{ qq: "abc" },
				),
			),
		).toBe(false);
	});

	it("returns false when site is invalid URL", () => {
		expect(
			canSubmitRegister(
				regState(
					{
						username: "validuser",
						password: "123456",
						confirmPassword: "123456",
						email: "u@e.com",
					},
					{ site: "not-a-url" },
				),
			),
		).toBe(false);
	});

	it("returns true when all fields valid (with education)", () => {
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

	it("returns true with valid birthday", () => {
		expect(
			canSubmitRegister(
				regState(
					{
						username: "validuser",
						password: "123456",
						confirmPassword: "123456",
						email: "user@example.com",
					},
					{ birthYear: "1990", birthMonth: "6", birthDay: "15" },
				),
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// buildRegisterProfile
// ---------------------------------------------------------------------------

describe("buildRegisterProfile", () => {
	it("returns undefined when all fields are defaults", () => {
		const state = regState(
			{ username: "u", password: "123456", confirmPassword: "123456", email: "u@e.com" },
			{ graduateSchool: "", campus: "" },
		);
		expect(buildRegisterProfile(state)).toBeUndefined();
	});

	it("includes gender when non-zero", () => {
		const state = regState(
			{ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" },
			{ gender: 1, graduateSchool: "", campus: "" },
		);
		expect(buildRegisterProfile(state)).toEqual({ gender: 1 });
	});

	it("includes campus when non-empty", () => {
		const state = regState(
			{ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" },
			{ campus: " 同济大学 ", graduateSchool: "" },
		);
		expect(buildRegisterProfile(state)).toEqual({ campus: "同济大学" });
	});

	it("includes numeric birthday fields", () => {
		const state = regState(
			{ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" },
			{ birthYear: "1990", birthMonth: "6", birthDay: "15", graduateSchool: "", campus: "" },
		);
		const profile = buildRegisterProfile(state);
		expect(profile).toEqual({ birthYear: 1990, birthMonth: 6, birthDay: 15 });
	});

	it("ignores non-numeric birthday strings", () => {
		const state = regState(
			{ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" },
			{ birthYear: "abc", birthMonth: "", birthDay: "", graduateSchool: "", campus: "" },
		);
		expect(buildRegisterProfile(state)).toBeUndefined();
	});

	it("includes multiple string fields trimmed", () => {
		const state = regState(
			{ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" },
			{ bio: " Hello ", qq: "12345", site: "https://example.com", graduateSchool: "", campus: "" },
		);
		expect(buildRegisterProfile(state)).toEqual({
			bio: "Hello",
			qq: "12345",
			site: "https://example.com",
		});
	});

	it("excludes fields that are empty strings", () => {
		const state = regState(
			{ username: "u", password: "p", confirmPassword: "p", email: "e@e.com" },
			{ bio: "", interest: "   ", graduateSchool: "", campus: "" },
		);
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
