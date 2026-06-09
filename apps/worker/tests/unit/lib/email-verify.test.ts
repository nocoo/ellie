// Unit tests for email-verification primitives (docs/17 §6.2).
// Covers code generator distribution, HMAC determinism, constant-time compare,
// email validation/normalization, and masking.

import { describe, expect, it } from "vitest";
import {
	codeKvKey,
	computeCodeHmac,
	constantTimeEqualHex,
	generateCode,
	isValidEmail,
	maskEmail,
	normalizeEmail,
} from "../../../src/lib/email-verify";

describe("generateCode", () => {
	it("returns a 6-character zero-padded numeric string", () => {
		for (let i = 0; i < 50; i++) {
			const c = generateCode();
			expect(c).toMatch(/^\d{6}$/);
		}
	});

	it("distributes uniformly enough across the 10⁶ space (chi-square sanity)", () => {
		// 10k samples across 10 buckets (digit-0 of code) — expected 1000 each.
		// We accept ±20% per bucket; a biased generator (e.g. naive %) would
		// skew the high digits. Tight enough to catch regressions, loose
		// enough to be non-flaky.
		const buckets = new Array<number>(10).fill(0);
		const N = 10_000;
		for (let i = 0; i < N; i++) {
			buckets[Number(generateCode()[0])]++;
		}
		const expected = N / 10;
		for (const b of buckets) {
			expect(b).toBeGreaterThan(expected * 0.8);
			expect(b).toBeLessThan(expected * 1.2);
		}
	});
});

describe("computeCodeHmac", () => {
	it("is deterministic for the same inputs", async () => {
		const a = await computeCodeHmac("k", 1, "u@example.com", "123456");
		const b = await computeCodeHmac("k", 1, "u@example.com", "123456");
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
	});

	it("changes when the userId changes", async () => {
		const a = await computeCodeHmac("k", 1, "u@example.com", "123456");
		const b = await computeCodeHmac("k", 2, "u@example.com", "123456");
		expect(a).not.toBe(b);
	});

	it("changes when the email changes", async () => {
		const a = await computeCodeHmac("k", 1, "u@example.com", "123456");
		const b = await computeCodeHmac("k", 1, "v@example.com", "123456");
		expect(a).not.toBe(b);
	});

	it("changes when the code changes", async () => {
		const a = await computeCodeHmac("k", 1, "u@example.com", "123456");
		const b = await computeCodeHmac("k", 1, "u@example.com", "654321");
		expect(a).not.toBe(b);
	});

	it("changes when the secret rotates", async () => {
		const a = await computeCodeHmac("k1", 1, "u@example.com", "123456");
		const b = await computeCodeHmac("k2", 1, "u@example.com", "123456");
		expect(a).not.toBe(b);
	});
});

describe("constantTimeEqualHex", () => {
	it("returns true for identical strings", () => {
		expect(constantTimeEqualHex("abcdef", "abcdef")).toBe(true);
	});

	it("returns false for different equal-length strings", () => {
		expect(constantTimeEqualHex("abcdef", "abcdee")).toBe(false);
	});

	it("returns false for different-length strings", () => {
		expect(constantTimeEqualHex("abcdef", "abc")).toBe(false);
	});

	it("returns true for two empty strings", () => {
		expect(constantTimeEqualHex("", "")).toBe(true);
	});
});

describe("isValidEmail", () => {
	it.each(["a@b.co", "user.name+tag@example.org", "x@y.zz"])("accepts %s", (s) =>
		expect(isValidEmail(s)).toBe(true));

	it.each(["", "no-at-sign", "no@domain", "spaces in@addr.com", "a@b"])("rejects %s", (s) =>
		expect(isValidEmail(s)).toBe(false));

	it("rejects oversize emails (> 254 chars)", () => {
		const local = "a".repeat(260);
		expect(isValidEmail(`${local}@b.co`)).toBe(false);
	});
});

describe("normalizeEmail", () => {
	it("lowercases and trims", () => {
		expect(normalizeEmail("  USER@EXAMPLE.COM  ")).toBe("user@example.com");
	});
});

describe("maskEmail", () => {
	it("hides everything except the first character of the local part", () => {
		expect(maskEmail("user@example.com")).toBe("u***@example.com");
	});

	it("returns *** when no @ is present", () => {
		expect(maskEmail("oops")).toBe("***");
	});
});

describe("codeKvKey", () => {
	it("namespaces by user id", () => {
		expect(codeKvKey(42)).toBe("email_verify:42");
	});
});
