// clientIp.test.ts — Phase G.1 unit coverage for the unified IP extractor.
//
// Validates the trust ladder and the production guard around X-Forwarded-For.

import { describe, expect, it } from "vitest";
import { extractTrustedClientIp, isServerToWorkerRequest } from "../../../src/lib/clientIp";
import { TEST_ADMIN_API_KEY, TEST_API_KEY, makeEnv } from "../../helpers";

function req(headers: Record<string, string>): Request {
	return new Request("https://api.example.com/", { headers });
}

describe("isServerToWorkerRequest", () => {
	const env = makeEnv();
	it("returns true for Key A", () => {
		expect(isServerToWorkerRequest(req({ "X-API-Key": TEST_API_KEY }), env)).toBe(true);
	});
	it("returns true for Key B", () => {
		expect(isServerToWorkerRequest(req({ "X-API-Key": TEST_ADMIN_API_KEY }), env)).toBe(true);
	});
	it("accepts header name in either case", () => {
		expect(isServerToWorkerRequest(req({ "x-api-key": TEST_API_KEY }), env)).toBe(true);
	});
	it("returns false for missing key", () => {
		expect(isServerToWorkerRequest(req({}), env)).toBe(false);
	});
	it("returns false for unrecognized key", () => {
		expect(isServerToWorkerRequest(req({ "X-API-Key": "bogus" }), env)).toBe(false);
	});
});

describe("extractTrustedClientIp", () => {
	it("prefers CF-Connecting-IP over everything", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(
			req({
				"CF-Connecting-IP": "1.1.1.1",
				"X-Real-IP": "2.2.2.2",
				"X-Forwarded-For": "3.3.3.3",
				"X-API-Key": TEST_API_KEY,
			}),
			env,
		);
		expect(ip).toBe("1.1.1.1");
	});

	it("trusts X-Real-IP when request carries Key A", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(
			req({ "X-Real-IP": "5.5.5.5", "X-API-Key": TEST_API_KEY }),
			env,
		);
		expect(ip).toBe("5.5.5.5");
	});

	it("trusts X-Real-IP when request carries Key B", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(
			req({ "X-Real-IP": "5.5.5.5", "X-API-Key": TEST_ADMIN_API_KEY }),
			env,
		);
		expect(ip).toBe("5.5.5.5");
	});

	it("REJECTS X-Real-IP without server-to-worker auth (anti-spoof)", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(req({ "X-Real-IP": "5.5.5.5" }), env);
		expect(ip).toBeNull();
	});

	it("ignores X-Forwarded-For in production even when present", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(req({ "X-Forwarded-For": "9.9.9.9, 8.8.8.8" }), env);
		expect(ip).toBeNull();
	});

	it("accepts X-Forwarded-For first segment outside production (dev/test)", () => {
		const env = makeEnv({ ENVIRONMENT: "test" });
		const ip = extractTrustedClientIp(req({ "X-Forwarded-For": "9.9.9.9, 8.8.8.8" }), env);
		expect(ip).toBe("9.9.9.9");
	});

	it("opts.allowXffInNonProd=false suppresses the dev/test fallback", () => {
		const env = makeEnv({ ENVIRONMENT: "test" });
		const ip = extractTrustedClientIp(req({ "X-Forwarded-For": "9.9.9.9" }), env, {
			allowXffInNonProd: false,
		});
		expect(ip).toBeNull();
	});

	it("returns null when no trusted source is present", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(req({}), env);
		expect(ip).toBeNull();
	});

	it("trims whitespace on returned values", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(req({ "CF-Connecting-IP": "  1.1.1.1  " }), env);
		expect(ip).toBe("1.1.1.1");
	});

	it("supports IPv6 verbatim", () => {
		const env = makeEnv({ ENVIRONMENT: "production" });
		const ip = extractTrustedClientIp(req({ "CF-Connecting-IP": "2001:4860:4860::8888" }), env);
		expect(ip).toBe("2001:4860:4860::8888");
	});
});
