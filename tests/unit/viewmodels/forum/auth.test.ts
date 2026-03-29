import { describe, expect, it } from "bun:test";
import { canSubmitLogin, loginErrorMessage } from "../../../../apps/web/src/viewmodels/forum/auth";

// ---------------------------------------------------------------------------
// canSubmitLogin
// ---------------------------------------------------------------------------

describe("canSubmitLogin", () => {
	it("returns false when both empty", () => {
		expect(canSubmitLogin("", "")).toBe(false);
	});

	it("returns false when username empty", () => {
		expect(canSubmitLogin("", "password")).toBe(false);
	});

	it("returns false when password empty", () => {
		expect(canSubmitLogin("admin", "")).toBe(false);
	});

	it("returns true when both non-empty", () => {
		expect(canSubmitLogin("admin", "password")).toBe(true);
	});

	it("trims whitespace from username", () => {
		expect(canSubmitLogin("  ", "password")).toBe(false);
	});

	it("trims whitespace from password", () => {
		expect(canSubmitLogin("admin", "  ")).toBe(false);
	});

	it("accepts inputs with surrounding whitespace", () => {
		expect(canSubmitLogin(" admin ", " pass ")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// loginErrorMessage
// ---------------------------------------------------------------------------

describe("loginErrorMessage", () => {
	it("returns null for null input", () => {
		expect(loginErrorMessage(null)).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(loginErrorMessage(undefined)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(loginErrorMessage("")).toBeNull();
	});

	it("maps CredentialsSignin to chinese error", () => {
		expect(loginErrorMessage("CredentialsSignin")).toBe("用户名或密码错误");
	});

	it("maps AccessDenied to ban message", () => {
		expect(loginErrorMessage("AccessDenied")).toBe("账号已被禁用");
	});

	it("maps unknown error to generic message", () => {
		expect(loginErrorMessage("SomethingElse")).toBe("登录失败，请重试");
	});
});
