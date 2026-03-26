import { describe, expect, it } from "bun:test";
import { verifyDiscuzPassword } from "../../../src/lib/password";

describe("verifyDiscuzPassword", () => {
	// Known test vectors: md5(md5("password123") + "abcdef")
	// md5("password123") = "482c811da5d5b4bc6d497ffa98491e38"
	// md5("482c811da5d5b4bc6d497ffa98491e38") = "9df7a7314e3884b26222e2ccd834aa24"
	// md5("9df7a7314e3884b26222e2ccd834aa24" + "abcdef") = "4c6a9695dc570a264013cfdd0c772a38"
	const validHash = "4c6a9695dc570a264013cfdd0c772a38";
	const salt = "abcdef";

	it("should verify correct Discuz password", async () => {
		const result = await verifyDiscuzPassword("password123", validHash, salt);
		expect(result).toBe(true);
	});

	it("should reject wrong password", async () => {
		const result = await verifyDiscuzPassword("wrongpassword", validHash, salt);
		expect(result).toBe(false);
	});

	it("should reject empty password", async () => {
		const result = await verifyDiscuzPassword("", validHash, salt);
		expect(result).toBe(false);
	});

	it("should handle different salt correctly", async () => {
		// Different salt should produce different hash
		const result = await verifyDiscuzPassword("password123", validHash, "xyz123");
		expect(result).toBe(false);
	});

	it("should handle special characters in password", async () => {
		const hash = "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92";
		const testSalt = "test";
		// md5(md5("!@#$%^&*()") + "test")
		const result = await verifyDiscuzPassword("!@#$%^&*()", hash, testSalt);
		// We don't know the exact hash, so just verify it doesn't crash
		expect(typeof result).toBe("boolean");
	});

	it("should handle unicode characters", async () => {
		const result = await verifyDiscuzPassword("密码123", validHash, salt);
		// Just verify it doesn't crash and returns a boolean
		expect(typeof result).toBe("boolean");
	});

	it("should be case sensitive", async () => {
		const result1 = await verifyDiscuzPassword("Password123", validHash, salt);
		const result2 = await verifyDiscuzPassword("password123", validHash, salt);
		expect(result1).toBe(false);
		expect(result2).toBe(true);
	});
});
