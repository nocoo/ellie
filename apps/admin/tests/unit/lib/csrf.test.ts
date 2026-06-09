import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAllowedOrigins, isMutatingMethod, validateOrigin } from "@/lib/csrf";

describe("csrf", () => {
	const originalEnv = process.env.AUTH_URL;

	beforeEach(() => {
		process.env.AUTH_URL = "https://admin.example.com";
	});

	afterEach(() => {
		process.env.AUTH_URL = originalEnv;
	});

	describe("getAllowedOrigins", () => {
		it("includes AUTH_URL and localhost origins", () => {
			const origins = getAllowedOrigins();
			expect(origins).toContain("https://admin.example.com");
			expect(origins).toContain("http://localhost:7032");
			expect(origins).toContain("http://localhost:3000");
		});

		it("filters out falsy when AUTH_URL is undefined", () => {
			process.env.AUTH_URL = "";
			const origins = getAllowedOrigins();
			expect(origins).not.toContain("");
			expect(origins.length).toBe(2);
		});
	});

	describe("validateOrigin", () => {
		it("returns true for allowed origin", () => {
			const req = new Request("http://localhost/api", {
				headers: { Origin: "https://admin.example.com" },
			});
			expect(validateOrigin(req)).toBe(true);
		});

		it("returns true for localhost origin", () => {
			const req = new Request("http://localhost/api", {
				headers: { Origin: "http://localhost:7032" },
			});
			expect(validateOrigin(req)).toBe(true);
		});

		it("returns false when no Origin or Referer", () => {
			const req = new Request("http://localhost/api");
			expect(validateOrigin(req)).toBe(false);
		});

		it("returns false for unknown origin", () => {
			const req = new Request("http://localhost/api", {
				headers: { Origin: "https://evil.com" },
			});
			expect(validateOrigin(req)).toBe(false);
		});

		it("prevents prefix-based attacks", () => {
			const req = new Request("http://localhost/api", {
				headers: { Origin: "https://admin.example.com.evil.com" },
			});
			expect(validateOrigin(req)).toBe(false);
		});

		it("uses Referer as fallback when Origin is absent", () => {
			const req = new Request("http://localhost/api", {
				headers: { Referer: "https://admin.example.com/path" },
			});
			expect(validateOrigin(req)).toBe(true);
		});
	});

	describe("isMutatingMethod", () => {
		it("returns false for GET and HEAD", () => {
			expect(isMutatingMethod("GET")).toBe(false);
			expect(isMutatingMethod("HEAD")).toBe(false);
		});

		it("returns true for mutating methods", () => {
			expect(isMutatingMethod("POST")).toBe(true);
			expect(isMutatingMethod("PUT")).toBe(true);
			expect(isMutatingMethod("PATCH")).toBe(true);
			expect(isMutatingMethod("DELETE")).toBe(true);
		});
	});
});
