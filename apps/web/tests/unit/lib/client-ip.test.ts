import { extractClientIp } from "@/lib/client-ip";
import { afterEach, describe, expect, test, vi } from "vitest";

function makeReq(headers: Record<string, string>): Request {
	return new Request("http://example.com/", { headers });
}

function makeHeadersBag(headers: Record<string, string>): { get(name: string): string | null } {
	const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
	return {
		get(name: string) {
			return lower[name.toLowerCase()] ?? null;
		},
	};
}

describe("extractClientIp", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	test("returns CF-Connecting-IP when present", () => {
		const ip = extractClientIp(makeReq({ "cf-connecting-ip": "1.2.3.4" }));
		expect(ip).toBe("1.2.3.4");
	});

	test("does NOT trust inbound x-real-ip (would let attackers bypass rate limits)", () => {
		// In production, x-real-ip from a public-internet request must be
		// ignored. The BFF only re-emits a trustworthy IP under Key A.
		vi.stubEnv("NODE_ENV", "production");
		const ip = extractClientIp(makeReq({ "x-real-ip": "9.9.9.9" }));
		expect(ip).toBe("");
	});

	test("ignores x-real-ip even outside production", () => {
		// Belt-and-braces: never honor x-real-ip from inbound requests.
		vi.stubEnv("NODE_ENV", "development");
		const ip = extractClientIp(makeReq({ "x-real-ip": "9.9.9.9" }));
		expect(ip).toBe("");
	});

	test("CF header takes precedence over x-real-ip", () => {
		vi.stubEnv("NODE_ENV", "production");
		const ip = extractClientIp(makeReq({ "cf-connecting-ip": "1.2.3.4", "x-real-ip": "9.9.9.9" }));
		expect(ip).toBe("1.2.3.4");
	});

	test("accepts XFF outside production", () => {
		vi.stubEnv("NODE_ENV", "development");
		const ip = extractClientIp(makeReq({ "x-forwarded-for": "5.5.5.5, 6.6.6.6" }));
		expect(ip).toBe("5.5.5.5");
	});

	test("rejects XFF in production", () => {
		vi.stubEnv("NODE_ENV", "production");
		const ip = extractClientIp(makeReq({ "x-forwarded-for": "5.5.5.5" }));
		expect(ip).toBe("");
	});

	test("allowXffInNonProd=false simulates production branch", () => {
		vi.stubEnv("NODE_ENV", "development");
		const ip = extractClientIp(makeReq({ "x-forwarded-for": "5.5.5.5" }), {
			allowXffInNonProd: false,
		});
		expect(ip).toBe("");
	});

	test("returns empty string when no trustworthy header present", () => {
		vi.stubEnv("NODE_ENV", "production");
		const ip = extractClientIp(makeReq({}));
		expect(ip).toBe("");
	});

	test("accepts a bare headers bag (next/headers shape)", () => {
		const bag = makeHeadersBag({ "cf-connecting-ip": "1.2.3.4" });
		expect(extractClientIp(bag)).toBe("1.2.3.4");
	});
});
