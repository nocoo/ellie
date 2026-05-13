// client-ip.test.ts — Phase G.2 unit coverage for admin BFF client-IP read.
//
// Trust-ladder contract: CF-Connecting-IP is always trusted; XFF first
// segment is honored only outside production. The opts toggle lets tests
// simulate production explicitly.

import { extractClientIp } from "@/lib/client-ip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: string | undefined): void {
	(process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function req(headers: Record<string, string>): Request {
	return new Request("https://admin.example.com/", { headers });
}

afterEach(() => {
	setNodeEnv(originalNodeEnv);
});

describe("extractClientIp — CF priority", () => {
	it("prefers CF-Connecting-IP regardless of env", () => {
		setNodeEnv("production");
		expect(
			extractClientIp(
				req({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "198.51.100.1" }),
			),
		).toBe("203.0.113.7");
	});

	it("trims whitespace from CF header", () => {
		expect(extractClientIp(req({ "CF-Connecting-IP": "  203.0.113.7  " }))).toBe("203.0.113.7");
	});

	it("is case-insensitive on header names", () => {
		expect(extractClientIp(req({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
	});

	it("supports IPv6 verbatim", () => {
		expect(extractClientIp(req({ "CF-Connecting-IP": "2001:4860:4860::8888" }))).toBe(
			"2001:4860:4860::8888",
		);
	});
});

describe("extractClientIp — XFF gating", () => {
	beforeEach(() => {
		setNodeEnv("test");
	});

	it("falls back to first segment of X-Forwarded-For outside production", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": "198.51.100.1, 10.0.0.1" }))).toBe(
			"198.51.100.1",
		);
	});

	it("trims whitespace from XFF first segment", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": "  198.51.100.1  " }))).toBe("198.51.100.1");
	});

	it("returns empty when XFF is empty after split", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": ",,," }))).toBe("");
	});

	it("opts.allowXffInNonProd=false suppresses XFF even outside production", () => {
		expect(
			extractClientIp(req({ "X-Forwarded-For": "198.51.100.1" }), { allowXffInNonProd: false }),
		).toBe("");
	});
});

describe("extractClientIp — production guard", () => {
	beforeEach(() => {
		setNodeEnv("production");
	});

	it("returns empty when only XFF is present in production (anti-spoof)", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": "198.51.100.1, 10.0.0.1" }))).toBe("");
	});

	it("ignores opts.allowXffInNonProd in production (CF-only)", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": "198.51.100.1" }), {})).toBe("");
	});
});

describe("extractClientIp — empty fallback", () => {
	it("returns empty string when neither header is present", () => {
		expect(extractClientIp(req({}))).toBe("");
	});
});
