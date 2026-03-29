import { afterEach, describe, expect, it } from "bun:test";
import { isAdminRoute, isPublicRoute, resolveProxyAction } from "../../apps/web/src/proxy";

// ---------------------------------------------------------------------------
// isPublicRoute
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// isAdminRoute
// ---------------------------------------------------------------------------

describe("isAdminRoute", () => {
	it("returns true for /admin", () => {
		expect(isAdminRoute("/admin")).toBe(true);
	});

	it("returns true for /admin/users", () => {
		expect(isAdminRoute("/admin/users")).toBe(true);
	});

	it("returns true for /admin/forums", () => {
		expect(isAdminRoute("/admin/forums")).toBe(true);
	});

	it("returns false for /login", () => {
		expect(isAdminRoute("/login")).toBe(false);
	});

	it("returns false for /api/admin/stats", () => {
		expect(isAdminRoute("/api/admin/stats")).toBe(false);
	});

	it("returns false for root /", () => {
		expect(isAdminRoute("/")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveProxyAction — with admin whitelist
// ---------------------------------------------------------------------------

describe("resolveProxyAction", () => {
	const ADMIN_EMAIL = "admin@example.com";
	const NON_ADMIN_EMAIL = "nobody@example.com";
	const originalEnv = process.env.ADMIN_EMAILS;

	afterEach(() => {
		if (originalEnv === undefined) {
			process.env.ADMIN_EMAILS = undefined;
		} else {
			process.env.ADMIN_EMAILS = originalEnv;
		}
	});

	it("allows public routes for unauthenticated users", () => {
		expect(resolveProxyAction("/login", false)).toBe("next");
		expect(resolveProxyAction("/api/auth/signin", false)).toBe("next");
	});

	it("allows public routes for authenticated non-admin users", () => {
		expect(resolveProxyAction("/api/auth/session", true, NON_ADMIN_EMAIL)).toBe("next");
	});

	it("redirects authenticated admin on /login to /admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/login", true, ADMIN_EMAIL)).toBe("redirect:/admin");
	});

	it("does NOT redirect authenticated non-admin on /login to /admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/login", true, NON_ADMIN_EMAIL)).toBe("next");
	});

	it("does NOT redirect authenticated user without email on /login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/login", true, null)).toBe("next");
		expect(resolveProxyAction("/login", true, undefined)).toBe("next");
	});

	it("redirects unauthenticated user on admin route to /login", () => {
		expect(resolveProxyAction("/admin", false)).toBe("redirect:/login");
		expect(resolveProxyAction("/admin/users", false)).toBe("redirect:/login");
	});

	it("redirects authenticated non-admin on admin route to /login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin", true, NON_ADMIN_EMAIL)).toBe("redirect:/login");
		expect(resolveProxyAction("/admin/users", true, NON_ADMIN_EMAIL)).toBe("redirect:/login");
	});

	it("redirects authenticated user without email on admin route to /login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin", true, null)).toBe("redirect:/login");
	});

	it("allows authenticated admin on admin route", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin", true, ADMIN_EMAIL)).toBe("next");
		expect(resolveProxyAction("/admin/users", true, ADMIN_EMAIL)).toBe("next");
	});

	it("allows public API auth routes for authenticated admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/api/auth/session", true, ADMIN_EMAIL)).toBe("next");
	});
});
