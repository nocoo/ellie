import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mapPassword, verifyDzPassword } from "../../scripts/migrate/transform/password";

/** Helper: compute DZ-style password hash for testing. */
function dzHash(password: string, salt: string): string {
	const inner = createHash("md5").update(password).digest("hex");
	return createHash("md5").update(`${inner}${salt}`).digest("hex");
}

describe("mapPassword", () => {
	test("passes through hash and salt", () => {
		const result = mapPassword({
			hash: "41351b8d5de2c653d5f8cb1c85dec559",
			salt: "abc123",
		});
		expect(result.passwordHash).toBe("41351b8d5de2c653d5f8cb1c85dec559");
		expect(result.passwordSalt).toBe("abc123");
	});

	test("handles empty hash and salt", () => {
		const result = mapPassword({ hash: "", salt: "" });
		expect(result.passwordHash).toBe("");
		expect(result.passwordSalt).toBe("");
	});
});

describe("verifyDzPassword", () => {
	test("correct password verifies", () => {
		const hash = dzHash("test123", "abcdef");
		expect(verifyDzPassword("test123", hash, "abcdef")).toBe(true);
	});

	test("wrong password fails", () => {
		const hash = dzHash("test123", "abcdef");
		expect(verifyDzPassword("wrong_password", hash, "abcdef")).toBe(false);
	});

	test("wrong salt fails", () => {
		const hash = dzHash("test123", "abcdef");
		expect(verifyDzPassword("test123", hash, "xxxxxx")).toBe(false);
	});

	test("empty password with matching hash", () => {
		const hash = dzHash("", "salt00");
		expect(verifyDzPassword("", hash, "salt00")).toBe(true);
	});
});
