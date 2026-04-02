import { afterEach, describe, expect, it } from "bun:test";
import {
	buildRedirectUrl,
	isAdminRoute,
	isForumAuthRoute,
	isPublicRoute,
	resolveProxyAction,
} from "../../apps/web/src/proxy";

// ---------------------------------------------------------------------------
// isPublicRoute
// ---------------------------------------------------------------------------

describe("isPublicRoute", () => {
	it("marks /login as public (forum login)", () => {
		expect(isPublicRoute("/login")).toBe(true);
	});

	it("marks /admin/login as public (admin login)", () => {
		expect(isPublicRoute("/admin/login")).toBe(true);
	});

	it("marks /api/auth paths as public", () => {
		expect(isPublicRoute("/api/auth/signin")).toBe(true);
		expect(isPublicRoute("/api/auth/callback/google")).toBe(true);
	});

	it("marks root / as public", () => {
		expect(isPublicRoute("/")).toBe(true);
	});

	it("marks forum listing pages as public", () => {
		expect(isPublicRoute("/forums")).toBe(true);
		expect(isPublicRoute("/forums/10")).toBe(true);
		expect(isPublicRoute("/forums/10/some-slug")).toBe(true);
	});

	it("marks thread pages as public", () => {
		expect(isPublicRoute("/threads")).toBe(true);
		expect(isPublicRoute("/threads/123")).toBe(true);
	});

	it("marks /threads/new as NOT public", () => {
		expect(isPublicRoute("/threads/new")).toBe(false);
	});

	it("marks user profile pages as public", () => {
		expect(isPublicRoute("/users")).toBe(true);
		expect(isPublicRoute("/users/42")).toBe(true);
	});

	it("marks /digest as public", () => {
		expect(isPublicRoute("/digest")).toBe(true);
	});

	it("marks /search as public", () => {
		expect(isPublicRoute("/search")).toBe(true);
	});

	it("marks /register as public", () => {
		expect(isPublicRoute("/register")).toBe(true);
	});

	it("marks /admin as non-public", () => {
		expect(isPublicRoute("/admin")).toBe(false);
	});

	it("marks /admin/users as non-public", () => {
		expect(isPublicRoute("/admin/users")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// isForumAuthRoute
// ---------------------------------------------------------------------------

describe("isForumAuthRoute", () => {
	it("returns true for /threads/new", () => {
		expect(isForumAuthRoute("/threads/new")).toBe(true);
	});

	it("returns false for /threads/123", () => {
		expect(isForumAuthRoute("/threads/123")).toBe(false);
	});

	it("returns false for /", () => {
		expect(isForumAuthRoute("/")).toBe(false);
	});

	it("returns false for /admin", () => {
		expect(isForumAuthRoute("/admin")).toBe(false);
	});

	it("returns false for /login", () => {
		expect(isForumAuthRoute("/login")).toBe(false);
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

	it("returns false for /admin/login (admin login is public)", () => {
		expect(isAdminRoute("/admin/login")).toBe(false);
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
// resolveProxyAction
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

	// -----------------------------------------------------------------------
	// Public routes
	// -----------------------------------------------------------------------

	it("allows public routes for unauthenticated users", () => {
		expect(resolveProxyAction("/login", false)).toBe("next");
		expect(resolveProxyAction("/admin/login", false)).toBe("next");
		expect(resolveProxyAction("/api/auth/signin", false)).toBe("next");
	});

	it("allows public routes for authenticated non-admin users", () => {
		expect(resolveProxyAction("/api/auth/session", true, NON_ADMIN_EMAIL)).toBe("next");
	});

	it("allows public API auth routes for authenticated admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/api/auth/session", true, ADMIN_EMAIL)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Admin login page redirect
	// -----------------------------------------------------------------------

	it("redirects authenticated admin on /admin/login to /admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin/login", true, ADMIN_EMAIL)).toBe("redirect:/admin");
	});

	it("does NOT redirect authenticated non-admin on /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin/login", true, NON_ADMIN_EMAIL)).toBe("next");
	});

	it("does NOT redirect authenticated user without email on /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin/login", true, null)).toBe("next");
		expect(resolveProxyAction("/admin/login", true, undefined)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Admin routes -> /admin/login
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on admin route to /admin/login", () => {
		expect(resolveProxyAction("/admin", false)).toBe("redirect:/admin/login");
		expect(resolveProxyAction("/admin/users", false)).toBe("redirect:/admin/login");
	});

	it("redirects authenticated non-admin on admin route to /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin", true, NON_ADMIN_EMAIL)).toBe("redirect:/admin/login");
		expect(resolveProxyAction("/admin/users", true, NON_ADMIN_EMAIL)).toBe("redirect:/admin/login");
	});

	it("redirects authenticated user without email on admin route to /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin", true, null)).toBe("redirect:/admin/login");
	});

	it("allows authenticated admin on admin route", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin", true, ADMIN_EMAIL)).toBe("next");
		expect(resolveProxyAction("/admin/users", true, ADMIN_EMAIL)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Forum public routes
	// -----------------------------------------------------------------------

	it("allows unauthenticated users on forum public routes", () => {
		expect(resolveProxyAction("/", false)).toBe("next");
		expect(resolveProxyAction("/forums/10", false)).toBe("next");
		expect(resolveProxyAction("/threads/123", false)).toBe("next");
		expect(resolveProxyAction("/users/42", false)).toBe("next");
		expect(resolveProxyAction("/digest", false)).toBe("next");
		expect(resolveProxyAction("/search", false)).toBe("next");
	});

	it("allows authenticated users on forum public routes", () => {
		expect(resolveProxyAction("/", true, NON_ADMIN_EMAIL)).toBe("next");
		expect(resolveProxyAction("/forums/10", true, NON_ADMIN_EMAIL)).toBe("next");
		expect(resolveProxyAction("/threads/123", true, NON_ADMIN_EMAIL)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Forum auth routes (/threads/new)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on /threads/new to /login", () => {
		expect(resolveProxyAction("/threads/new", false)).toBe("redirect:/login");
	});

	it("allows authenticated credentials user on /threads/new", () => {
		expect(resolveProxyAction("/threads/new", true, NON_ADMIN_EMAIL, "credentials")).toBe("next");
	});

	it("redirects Google OAuth user on /threads/new to /login (no Worker JWT)", () => {
		expect(resolveProxyAction("/threads/new", true, ADMIN_EMAIL, "google")).toBe("redirect:/login");
	});

	it("redirects user without provider on /threads/new to /login", () => {
		expect(resolveProxyAction("/threads/new", true, NON_ADMIN_EMAIL)).toBe("redirect:/login");
		expect(resolveProxyAction("/threads/new", true, NON_ADMIN_EMAIL, null)).toBe("redirect:/login");
		expect(resolveProxyAction("/threads/new", true, NON_ADMIN_EMAIL, undefined)).toBe(
			"redirect:/login",
		);
	});

	it("allows authenticated credentials admin on /threads/new", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/threads/new", true, ADMIN_EMAIL, "credentials")).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Credentials user redirect from /login and /register
	// -----------------------------------------------------------------------

	it("redirects credentials user on /login to /", () => {
		expect(resolveProxyAction("/login", true, NON_ADMIN_EMAIL, "credentials")).toBe("redirect:/");
	});

	it("redirects credentials user on /register to /", () => {
		expect(resolveProxyAction("/register", true, NON_ADMIN_EMAIL, "credentials")).toBe(
			"redirect:/",
		);
	});

	it("allows Google OAuth user on /login (needs forum account)", () => {
		expect(resolveProxyAction("/login", true, NON_ADMIN_EMAIL, "google")).toBe("next");
	});

	it("allows Google OAuth user on /register (needs forum account)", () => {
		expect(resolveProxyAction("/register", true, NON_ADMIN_EMAIL, "google")).toBe("next");
	});

	it("allows unauthenticated user on /login", () => {
		expect(resolveProxyAction("/login", false)).toBe("next");
	});

	it("allows unauthenticated user on /register", () => {
		expect(resolveProxyAction("/register", false)).toBe("next");
	});

	it("does not redirect credentials user on other public routes like /forums", () => {
		expect(resolveProxyAction("/forums", true, NON_ADMIN_EMAIL, "credentials")).toBe("next");
		expect(resolveProxyAction("/", true, NON_ADMIN_EMAIL, "credentials")).toBe("next");
		expect(resolveProxyAction("/threads/123", true, NON_ADMIN_EMAIL, "credentials")).toBe("next");
	});

	it("admin redirect on /admin/login still works", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction("/admin/login", true, ADMIN_EMAIL)).toBe("redirect:/admin");
	});

	// -----------------------------------------------------------------------
	// Non-public, non-admin, non-forum-auth routes (catch-all)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on unknown non-public route to /login", () => {
		expect(resolveProxyAction("/some-unknown-route", false)).toBe("redirect:/login");
	});

	it("allows authenticated user on unknown non-public route", () => {
		expect(resolveProxyAction("/some-unknown-route", true, NON_ADMIN_EMAIL)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Edge: logged-in user without provider on /login and /register
	// -----------------------------------------------------------------------

	it("does not redirect logged-in user with no provider on /login", () => {
		expect(resolveProxyAction("/login", true, NON_ADMIN_EMAIL, undefined)).toBe("next");
	});

	it("does not redirect logged-in user with no provider on /register", () => {
		expect(resolveProxyAction("/register", true, NON_ADMIN_EMAIL, undefined)).toBe("next");
	});
});

// ---------------------------------------------------------------------------
// buildRedirectUrl
// ---------------------------------------------------------------------------

describe("buildRedirectUrl", () => {
	function makeMockRequest(url: string, headers?: Record<string, string>) {
		return {
			headers: {
				get(name: string) {
					return headers?.[name] ?? null;
				},
			},
			nextUrl: {
				origin: new URL(url).origin,
			},
		} as Parameters<typeof buildRedirectUrl>[0];
	}

	it("uses x-forwarded-host and x-forwarded-proto when available", () => {
		const req = makeMockRequest("https://app.example.com/path", {
			"x-forwarded-host": "proxy.example.com",
			"x-forwarded-proto": "https",
		});
		const result = buildRedirectUrl(req, "/admin");
		expect(result.href).toBe("https://proxy.example.com/admin");
	});

	it("uses x-forwarded-host with http proto when x-forwarded-proto is missing", () => {
		const req = makeMockRequest("https://app.example.com/path", {
			"x-forwarded-host": "proxy.example.com",
		});
		const result = buildRedirectUrl(req, "/admin");
		expect(result.href).toBe("https://proxy.example.com/admin");
	});

	it("falls back to request origin when no forwarded headers", () => {
		const req = makeMockRequest("https://app.example.com/path");
		const result = buildRedirectUrl(req, "/login");
		expect(result.href).toBe("https://app.example.com/login");
	});

	it("handles custom x-forwarded-proto value", () => {
		const req = makeMockRequest("https://app.example.com/path", {
			"x-forwarded-host": "proxy.example.com",
			"x-forwarded-proto": "http",
		});
		const result = buildRedirectUrl(req, "/admin/login");
		expect(result.href).toBe("http://proxy.example.com/admin/login");
	});
});
