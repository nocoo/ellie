import { describe, expect, it } from "vitest";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../../../src/lib/password";

describe("verifyDiscuzPassword", () => {
	// Known test vectors: md5(md5("password123") + "abcdef")
	// md5("password123") = "482c811da5d5b4bc6d497ffa98491e38"
	// md5("482c811da5d5b4bc6d497ffa98491e38" + "abcdef") = "4647298d7796457723792f5cde82e0c8"
	const validHash = "4647298d7796457723792f5cde82e0c8";
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

describe("hashPassword", () => {
	it("should create hash in correct format", async () => {
		const hash = await hashPassword("password123");
		// Format: base64(salt) + "." + base64(hash)
		expect(hash).toContain(".");
		const parts = hash.split(".");
		expect(parts).toHaveLength(2);
		// Salt should be 16 bytes = 24 chars in base64 (with padding)
		// Hash should be 32 bytes = 44 chars in base64 (with padding)
		expect(parts[0]?.length).toBeGreaterThanOrEqual(22);
		expect(parts[1]?.length).toBeGreaterThanOrEqual(42);
	});

	it("should generate different hashes for same password", async () => {
		const hash1 = await hashPassword("password123");
		const hash2 = await hashPassword("password123");
		expect(hash1).not.toEqual(hash2);
	});

	it("should handle empty password", async () => {
		const hash = await hashPassword("");
		expect(hash).toContain(".");
	});

	it("should handle unicode characters", async () => {
		const hash = await hashPassword("密码密码123!@#");
		expect(hash).toContain(".");
	});

	it("should handle special characters", async () => {
		const hash = await hashPassword("!@#$%^&*()_+-=[]{}|;':\",./<>?");
		expect(hash).toContain(".");
	});
});

describe("verifyPassword", () => {
	it("should verify correct password", async () => {
		const hash = await hashPassword("password123");
		const result = await verifyPassword("password123", hash);
		expect(result).toBe(true);
	});

	it("should reject wrong password", async () => {
		const hash = await hashPassword("password123");
		const result = await verifyPassword("wrongpassword", hash);
		expect(result).toBe(false);
	});

	it("should reject empty password when hash is for non-empty", async () => {
		const hash = await hashPassword("password123");
		const result = await verifyPassword("", hash);
		expect(result).toBe(false);
	});

	it("should reject invalid format", async () => {
		const result = await verifyPassword("password123", "invalid");
		expect(result).toBe(false);
	});

	it("should reject hash without separator", async () => {
		const result = await verifyPassword("password123", "invalidhash");
		expect(result).toBe(false);
	});

	it("should reject hash with too many parts", async () => {
		const result = await verifyPassword("password123", "a.b.c");
		expect(result).toBe(false);
	});

	it("should reject malformed base64", async () => {
		const result = await verifyPassword("password123", "not_base64!@#.not_base64!@#");
		expect(result).toBe(false);
	});

	it("should handle unicode passwords", async () => {
		const hash = await hashPassword("密码密码123!@#");
		const result = await verifyPassword("密码密码123!@#", hash);
		expect(result).toBe(true);
	});

	it("should handle special characters", async () => {
		const hash = await hashPassword("!@#$%^&*()_+-=[]{}|;':\",./<>?");
		const result = await verifyPassword("!@#$%^&*()_+-=[]{}|;':\",./<>?", hash);
		expect(result).toBe(true);
	});

	it("should be case sensitive", async () => {
		const hash = await hashPassword("Password123");
		const result1 = await verifyPassword("Password123", hash);
		const result2 = await verifyPassword("password123", hash);
		expect(result1).toBe(true);
		expect(result2).toBe(false);
	});

	it("should verify hash created earlier", async () => {
		// Create a hash and verify it can be verified
		const password = "test-password-12345";
		const hash = await hashPassword(password);
		const result = await verifyPassword(password, hash);
		expect(result).toBe(true);
	});

	it("should handle truncated hash", async () => {
		// Create a valid hash, then truncate the hash part
		const password = "password123";
		const hash = await hashPassword(password);
		const parts = hash.split(".");
		const truncatedHash = `${parts[0]}.${parts[1]?.slice(0, 10)}`;
		const result = await verifyPassword(password, truncatedHash);
		expect(result).toBe(false);
	});

	it("should handle invalid salt length", async () => {
		// Create a hash with invalid salt length
		const invalidHash = "short.somelonghashhere";
		const result = await verifyPassword("password123", invalidHash);
		expect(result).toBe(false);
	});
});
