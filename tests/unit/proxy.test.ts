import { describe, expect, it } from "bun:test";
import { isPublicRoute, resolveProxyAction } from "../../apps/web/src/proxy";

describe("isPublicRoute", () => {
	it("marks /login as public", () => {
		expect(isPublicRoute("/login")).toBe(true);
	});

	it("marks /api/auth paths as public", () => {
		expect(isPublicRoute("/api/auth/signin")).toBe(true);
		expect(isPublicRoute("/api/auth/callback/google")).toBe(true);
	});

	it("marks /admin as non-public", () => {
		expect(isPublicRoute("/admin")).toBe(false);
	});

	it("marks /admin/users as non-public", () => {
		expect(isPublicRoute("/admin/users")).toBe(false);
	});

	it("marks root / as non-public", () => {
		expect(isPublicRoute("/")).toBe(false);
	});
});

describe("resolveProxyAction", () => {
	it("allows public routes for unauthenticated users", () => {
		expect(resolveProxyAction("/login", false)).toBe("next");
		expect(resolveProxyAction("/api/auth/signin", false)).toBe("next");
	});

	it("redirects authenticated user on /login to /admin", () => {
		expect(resolveProxyAction("/login", true)).toBe("redirect:/admin");
	});

	it("redirects unauthenticated user on non-public route to /login", () => {
		expect(resolveProxyAction("/admin", false)).toBe("redirect:/login");
		expect(resolveProxyAction("/admin/users", false)).toBe("redirect:/login");
	});

	it("allows authenticated user on non-public route", () => {
		expect(resolveProxyAction("/admin", true)).toBe("next");
		expect(resolveProxyAction("/admin/users", true)).toBe("next");
	});

	it("allows public API auth routes for authenticated users", () => {
		expect(resolveProxyAction("/api/auth/session", true)).toBe("next");
	});
});
