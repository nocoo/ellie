// client-ip.test.ts — Phase G.2 unit coverage for admin BFF client-IP read.

import { extractClientIp } from "@/lib/client-ip";
import { describe, expect, it } from "vitest";

function req(headers: Record<string, string>): Request {
	return new Request("https://admin.example.com/", { headers });
}

describe("extractClientIp", () => {
	it("prefers CF-Connecting-IP", () => {
		expect(
			extractClientIp(
				req({ "CF-Connecting-IP": "203.0.113.7", "X-Forwarded-For": "198.51.100.1" }),
			),
		).toBe("203.0.113.7");
	});

	it("falls back to first segment of X-Forwarded-For", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": "198.51.100.1, 10.0.0.1" }))).toBe(
			"198.51.100.1",
		);
	});

	it("trims whitespace from CF header", () => {
		expect(extractClientIp(req({ "CF-Connecting-IP": "  203.0.113.7  " }))).toBe("203.0.113.7");
	});

	it("trims whitespace from XFF first segment", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": "  198.51.100.1  " }))).toBe("198.51.100.1");
	});

	it("is case-insensitive on header names", () => {
		expect(extractClientIp(req({ "cf-connecting-ip": "203.0.113.7" }))).toBe("203.0.113.7");
	});

	it("returns empty string when neither header is present", () => {
		expect(extractClientIp(req({}))).toBe("");
	});

	it("returns empty string when XFF is empty after split", () => {
		expect(extractClientIp(req({ "X-Forwarded-For": ",,," }))).toBe("");
	});

	it("supports IPv6 verbatim", () => {
		expect(extractClientIp(req({ "CF-Connecting-IP": "2001:4860:4860::8888" }))).toBe(
			"2001:4860:4860::8888",
		);
	});
});
