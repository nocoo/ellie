import { getAllowedOrigins, isMutatingMethod, validateOrigin } from "@/lib/csrf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("csrf", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("getAllowedOrigins", () => {
		it("includes AUTH_URL and NEXT_PUBLIC_SITE_URL when set", () => {
			process.env.AUTH_URL = "https://auth.example.com";
			process.env.NEXT_PUBLIC_SITE_URL = "https://site.example.com";
			const origins = getAllowedOrigins();
			expect(origins).toContain("https://auth.example.com");
			expect(origins).toContain("https://site.example.com");
		});

		it("filters out falsy env vars", () => {
			process.env.AUTH_URL = undefined;
			process.env.NEXT_PUBLIC_SITE_URL = undefined;
			const origins = getAllowedOrigins();
			expect(origins).not.toContain(undefined);
			expect(origins).toContain("http://localhost:7031");
			expect(origins).toContain("http://localhost:3000");
		});

		it("always includes localhost origins", () => {
			const origins = getAllowedOrigins();
			expect(origins).toContain("http://localhost:7031");
			expect(origins).toContain("http://localhost:3000");
		});

		it("expands ALLOWED_ORIGINS comma-separated list", () => {
			process.env.ALLOWED_ORIGINS = "https://a.example.com,https://b.example.com";
			const origins = getAllowedOrigins();
			expect(origins).toContain("https://a.example.com");
			expect(origins).toContain("https://b.example.com");
		});

		it("handles ALLOWED_ORIGINS unset gracefully", () => {
			process.env.ALLOWED_ORIGINS = undefined;
			const origins = getAllowedOrigins();
			expect(origins).toContain("http://localhost:7031");
		});
	});

	describe("validateOrigin", () => {
		beforeEach(() => {
			process.env.AUTH_URL = "https://example.com";
		});

		it("returns false when no Origin or Referer header", () => {
			const req = new Request("http://localhost", { headers: {} });
			expect(validateOrigin(req)).toBe(false);
		});

		it("returns true for matching Origin header", () => {
			const req = new Request("http://localhost", {
				headers: { Origin: "https://example.com" },
			});
			expect(validateOrigin(req)).toBe(true);
		});

		it("returns true for matching Referer header", () => {
			const req = new Request("http://localhost", {
				headers: { Referer: "https://example.com/some/path" },
			});
			expect(validateOrigin(req)).toBe(true);
		});

		it("returns false for non-matching origin", () => {
			const req = new Request("http://localhost", {
				headers: { Origin: "https://evil.com" },
			});
			expect(validateOrigin(req)).toBe(false);
		});

		it("returns false for invalid URL in Origin", () => {
			const req = new Request("http://localhost", {
				headers: { Origin: "not-a-url" },
			});
			expect(validateOrigin(req)).toBe(false);
		});

		it("returns true for localhost origin", () => {
			const req = new Request("http://localhost", {
				headers: { Origin: "http://localhost:7031" },
			});
			expect(validateOrigin(req)).toBe(true);
		});
	});

	describe("isMutatingMethod", () => {
		it("returns false for GET", () => {
			expect(isMutatingMethod("GET")).toBe(false);
		});

		it("returns false for HEAD", () => {
			expect(isMutatingMethod("HEAD")).toBe(false);
		});

		it("returns true for POST", () => {
			expect(isMutatingMethod("POST")).toBe(true);
		});

		it("returns true for PUT", () => {
			expect(isMutatingMethod("PUT")).toBe(true);
		});

		it("returns true for DELETE", () => {
			expect(isMutatingMethod("DELETE")).toBe(true);
		});

		it("returns true for PATCH", () => {
			expect(isMutatingMethod("PATCH")).toBe(true);
		});
	});
});
