import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it, vi } from "vitest";
import { config } from "@/proxy";
import nextConfig from "../../next.config";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("static cache boundary", () => {
	it("bypasses authentication only for the actual theme script", () => {
		for (const url of ["/fouc.js", "/fouc.js?v=1", "/_next/static/chunks/app.js", "/favicon.ico"]) {
			expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(false);
		}
		for (const url of ["/fouc.js/private", "/threads/42", "/me"]) {
			expect(unstable_doesMiddlewareMatch({ config, nextConfig, url })).toBe(true);
		}
	});
});
