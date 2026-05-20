// client-ip.test.ts — P5 web client IP resolver tests.
//
// Coverage:
//   - cf-connecting-ip is trusted unconditionally.
//   - In production: x-forwarded-for / x-real-ip MUST be ignored.
//   - In non-production: first hop of x-forwarded-for is accepted as a
//     dev convenience; x-real-ip is accepted as a secondary fallback.
//   - Returns the empty string when nothing trusted is present.

import { resolveTrustedClientIp } from "@/lib/client-ip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function makeReq(headers: Record<string, string>): import("next/server").NextRequest {
	return {
		headers: new Headers(headers),
	} as unknown as import("next/server").NextRequest;
}

describe("resolveTrustedClientIp", () => {
	const origNodeEnv = process.env.NODE_ENV;
	beforeEach(() => {
		process.env.NODE_ENV = origNodeEnv;
	});
	afterEach(() => {
		process.env.NODE_ENV = origNodeEnv;
	});

	it("trusts cf-connecting-ip in any environment", () => {
		process.env.NODE_ENV = "production";
		expect(resolveTrustedClientIp(makeReq({ "cf-connecting-ip": "1.1.1.1" }))).toBe("1.1.1.1");
		process.env.NODE_ENV = "development";
		expect(resolveTrustedClientIp(makeReq({ "cf-connecting-ip": "2.2.2.2" }))).toBe("2.2.2.2");
	});

	it("ignores x-forwarded-for in production", () => {
		process.env.NODE_ENV = "production";
		expect(resolveTrustedClientIp(makeReq({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("");
	});

	it("ignores inbound x-real-ip in production", () => {
		process.env.NODE_ENV = "production";
		expect(resolveTrustedClientIp(makeReq({ "x-real-ip": "5.5.5.5" }))).toBe("");
	});

	it("accepts first hop of x-forwarded-for in non-production", () => {
		process.env.NODE_ENV = "development";
		expect(resolveTrustedClientIp(makeReq({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe(
			"9.9.9.9",
		);
	});

	it("falls back to x-real-ip in non-production when xff missing", () => {
		process.env.NODE_ENV = "development";
		expect(resolveTrustedClientIp(makeReq({ "x-real-ip": "5.5.5.5" }))).toBe("5.5.5.5");
	});

	it("returns empty string when no trusted source present", () => {
		process.env.NODE_ENV = "production";
		expect(resolveTrustedClientIp(makeReq({}))).toBe("");
	});

	it("CF wins over the dev-only x-forwarded-for fallback", () => {
		process.env.NODE_ENV = "development";
		expect(
			resolveTrustedClientIp(
				makeReq({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" }),
			),
		).toBe("1.1.1.1");
	});
});
