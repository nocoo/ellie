import { describe, expect, it } from "bun:test";
import { createJwt, isTokenExpired, verifyJwt } from "../../../src/lib/jwt";

describe("createJwt", () => {
	it("should create a valid JWT token", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);

		expect(token).toBeString();
		expect(token).toMatch(/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/);
	});

	it("should include iat (issued at) claim", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.iat).toBeDefined();
		expect(decoded.iat).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
	});

	it("should create different tokens for same payload with different secrets", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};

		const token1 = await createJwt(payload, "secret1");
		const token2 = await createJwt(payload, "secret2");

		expect(token1).not.toEqual(token2);
	});

	it("should handle special characters in secret", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "!@#$%^&*()_+-=[]{}|;':\",./<>?";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.userId).toBe(123);
		expect(decoded.role).toBe(1);
	});

	it("should handle unicode in secret", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "密码密码-secret-密钥";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.userId).toBe(123);
	});

	it("should encode userId and role correctly", async () => {
		const payload = {
			userId: 999,
			role: 3,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.userId).toBe(999);
		expect(decoded.role).toBe(3);
	});

	it("should handle very large userId", async () => {
		const payload = {
			userId: 9007199254740991, // Number.MAX_SAFE_INTEGER
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.userId).toBe(9007199254740991);
	});
});

describe("verifyJwt", () => {
	it("should verify a valid token", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.userId).toBe(123);
		expect(decoded.role).toBe(1);
		expect(decoded.exp).toBe(payload.exp);
		expect(decoded.iat).toBeDefined();
	});

	it("should throw error for invalid signature", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);

		await expect(verifyJwt(token, "wrong-secret")).rejects.toThrow("Invalid signature");
	});

	it("should throw error for malformed token", async () => {
		const secret = "test-secret";

		await expect(verifyJwt("invalid", secret)).rejects.toThrow("Invalid token format");
		await expect(verifyJwt("only.two", secret)).rejects.toThrow("Invalid token format");
		await expect(verifyJwt("a.b.c.d.e.f", secret)).rejects.toThrow("Invalid token format");
	});

	it("should throw error for tampered payload", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const parts = token.split(".");

		// Tamper with the payload
		const tamperedPayload = btoa(JSON.stringify({ userId: 999, role: 2 }));
		const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

		await expect(verifyJwt(tamperedToken, secret)).rejects.toThrow();
	});

	it("should throw error for tampered signature", async () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const parts = token.split(".");

		// Tamper with the signature
		const tamperedToken = `${parts[0]}.${parts[1]}.${"tampered_signature"
			.replace("+", "-")
			.replace("/", "_")}`;

		await expect(verifyJwt(tamperedToken, secret)).rejects.toThrow("Invalid signature");
	});

	it("should decode payload correctly", async () => {
		const payload = {
			userId: 456,
			role: 2,
			exp: 1234567890,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded).toEqual({
			userId: 456,
			role: 2,
			exp: 1234567890,
			iat: expect.any(Number),
		});
	});
});

describe("isTokenExpired", () => {
	it("should return false for non-expired token", () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
		};

		expect(isTokenExpired(payload)).toBe(false);
	});

	it("should return true for expired token", () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
		};

		expect(isTokenExpired(payload)).toBe(true);
	});

	it("should return false for token expiring now", () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000),
		};

		expect(isTokenExpired(payload)).toBe(false);
	});

	it("should return true for token expired 1 second ago", () => {
		const payload = {
			userId: 123,
			role: 1,
			exp: Math.floor(Date.now() / 1000) - 1,
		};

		expect(isTokenExpired(payload)).toBe(true);
	});
});

describe("JWT integration", () => {
	it("should create and verify token correctly", async () => {
		const originalPayload = {
			userId: 789,
			role: 3,
			exp: Math.floor(Date.now() / 1000) + 7200, // 2 hours
		};
		const secret = "integration-test-secret";

		const token = await createJwt(originalPayload, secret);
		const decodedPayload = await verifyJwt(token, secret);

		expect(decodedPayload.userId).toBe(originalPayload.userId);
		expect(decodedPayload.role).toBe(originalPayload.role);
		expect(decodedPayload.exp).toBe(originalPayload.exp);
	});

	it("should fail verification with different secret", async () => {
		const payload = {
			userId: 789,
			role: 3,
			exp: Math.floor(Date.now() / 1000) + 7200,
		};

		const token = await createJwt(payload, "secret1");

		await expect(verifyJwt(token, "secret2")).rejects.toThrow("Invalid signature");
	});

	it("should create 7-day token", async () => {
		const sevenDaysInSeconds = 7 * 24 * 60 * 60;
		const payload = {
			userId: 1,
			role: 1,
			exp: Math.floor(Date.now() / 1000) + sevenDaysInSeconds,
		};
		const secret = "test-secret";

		const token = await createJwt(payload, secret);
		const decoded = await verifyJwt(token, secret);

		expect(decoded.userId).toBe(1);
		expect(isTokenExpired(decoded)).toBe(false);
	});
});
