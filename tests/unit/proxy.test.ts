import { afterEach, describe, expect, it } from "bun:test";
import {
	buildRedirectUrl,
	isAdminRoute,
	isForumAuthRoute,
	isMessagesRoute,
	isPublicRoute,
	resolveProxyAction,
} from "../../apps/web/src/proxy";

/** Helper to create a URL object for testing resolveProxyAction */
function makeUrl(pathname: string, search = ""): URL {
	return new URL(`${pathname}${search}`, "https://example.com");
}

/** Helper to create forum session */
function forumSession(name = "testuser") {
	return { user: { name } };
}

/** Helper to create admin session */
function adminSession(email: string) {
	return { user: { email } };
}

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
// isMessagesRoute
// ---------------------------------------------------------------------------

describe("isMessagesRoute", () => {
	it("returns true for /messages", () => {
		expect(isMessagesRoute("/messages")).toBe(true);
	});

	it("returns true for /messages/123", () => {
		expect(isMessagesRoute("/messages/123")).toBe(true);
	});

	it("returns false for /", () => {
		expect(isMessagesRoute("/")).toBe(false);
	});

	it("returns false for /admin", () => {
		expect(isMessagesRoute("/admin")).toBe(false);
	});

	it("returns false for /threads/new", () => {
		expect(isMessagesRoute("/threads/new")).toBe(false);
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
		expect(resolveProxyAction(makeUrl("/login"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/admin/login"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/api/auth/signin"), null, null)).toBe("next");
	});

	it("allows public API auth routes for authenticated admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(
			resolveProxyAction(makeUrl("/api/auth/session"), forumSession(), adminSession(ADMIN_EMAIL)),
		).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Admin login page redirect
	// -----------------------------------------------------------------------

	it("redirects authenticated admin on /admin/login to /admin", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/admin/login"), null, adminSession(ADMIN_EMAIL))).toBe(
			"redirect:/admin",
		);
	});

	it("does NOT redirect authenticated non-admin on /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/admin/login"), null, adminSession(NON_ADMIN_EMAIL))).toBe(
			"next",
		);
	});

	it("does NOT redirect authenticated user without email on /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/admin/login"), forumSession(), null)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Admin routes -> /admin/login
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on admin route to /admin/login", () => {
		expect(resolveProxyAction(makeUrl("/admin"), null, null)).toBe("redirect:/admin/login");
		expect(resolveProxyAction(makeUrl("/admin/users"), null, null)).toBe("redirect:/admin/login");
	});

	it("redirects authenticated non-admin on admin route to /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(
			resolveProxyAction(makeUrl("/admin"), forumSession(), adminSession(NON_ADMIN_EMAIL)),
		).toBe("redirect:/admin/login");
		expect(
			resolveProxyAction(makeUrl("/admin/users"), forumSession(), adminSession(NON_ADMIN_EMAIL)),
		).toBe("redirect:/admin/login");
	});

	it("redirects user with only forum session on admin route to /admin/login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/admin"), forumSession(), null)).toBe(
			"redirect:/admin/login",
		);
	});

	it("allows authenticated admin on admin route", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/admin"), null, adminSession(ADMIN_EMAIL))).toBe("next");
		expect(resolveProxyAction(makeUrl("/admin/users"), null, adminSession(ADMIN_EMAIL))).toBe(
			"next",
		);
	});

	// -----------------------------------------------------------------------
	// Forum public routes
	// -----------------------------------------------------------------------

	it("allows unauthenticated users on forum public routes", () => {
		expect(resolveProxyAction(makeUrl("/"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/users/42"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/digest"), null, null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/search"), null, null)).toBe("next");
	});

	it("allows authenticated users on forum public routes", () => {
		expect(resolveProxyAction(makeUrl("/"), forumSession(), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), forumSession(), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), forumSession(), null)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Forum auth routes (/threads/new)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on /threads/new to /login", () => {
		expect(resolveProxyAction(makeUrl("/threads/new"), null, null)).toBe("redirect:/login");
	});

	it("allows authenticated forum user on /threads/new", () => {
		expect(resolveProxyAction(makeUrl("/threads/new"), forumSession(), null)).toBe("next");
	});

	it("redirects admin-only user (no forum session) on /threads/new to /login", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/threads/new"), null, adminSession(ADMIN_EMAIL))).toBe(
			"redirect:/login",
		);
	});

	// -----------------------------------------------------------------------
	// Messages routes (special handling)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on /messages to /login with redirect param", () => {
		const result = resolveProxyAction(makeUrl("/messages"), null, null);
		expect(result).toBe("redirect:/login?redirect=%2Fmessages");
	});

	it("redirects unauthenticated user on /messages with query to /login preserving query", () => {
		const result = resolveProxyAction(makeUrl("/messages", "?to=123"), null, null);
		expect(result).toBe("redirect:/login?redirect=%2Fmessages%3Fto%3D123");
	});

	it("allows forum user on /messages", () => {
		expect(resolveProxyAction(makeUrl("/messages"), forumSession(), null)).toBe("next");
	});

	it("allows forum user on /messages/123", () => {
		expect(resolveProxyAction(makeUrl("/messages/123"), forumSession(), null)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Credentials user redirect from /login and /register
	// -----------------------------------------------------------------------

	it("redirects forum user on /login to /", () => {
		expect(resolveProxyAction(makeUrl("/login"), forumSession(), null)).toBe("redirect:/");
	});

	it("redirects forum user on /register to /", () => {
		expect(resolveProxyAction(makeUrl("/register"), forumSession(), null)).toBe("redirect:/");
	});

	it("allows unauthenticated user on /login", () => {
		expect(resolveProxyAction(makeUrl("/login"), null, null)).toBe("next");
	});

	it("allows unauthenticated user on /register", () => {
		expect(resolveProxyAction(makeUrl("/register"), null, null)).toBe("next");
	});

	it("does not redirect forum user on other public routes like /forums", () => {
		expect(resolveProxyAction(makeUrl("/forums"), forumSession(), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/"), forumSession(), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), forumSession(), null)).toBe("next");
	});

	it("admin redirect on /admin/login still works", () => {
		process.env.ADMIN_EMAILS = ADMIN_EMAIL;
		expect(resolveProxyAction(makeUrl("/admin/login"), null, adminSession(ADMIN_EMAIL))).toBe(
			"redirect:/admin",
		);
	});

	// -----------------------------------------------------------------------
	// require_login feature flag
	// -----------------------------------------------------------------------

	it("allows unauthenticated user on public routes when requireLogin is false", () => {
		expect(resolveProxyAction(makeUrl("/"), null, null, false)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), null, null, false)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), null, null, false)).toBe("next");
	});

	it("redirects unauthenticated user on public routes when requireLogin is true", () => {
		expect(resolveProxyAction(makeUrl("/"), null, null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/forums/10"), null, null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/threads/123"), null, null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/digest"), null, null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/search"), null, null, true)).toBe("redirect:/login");
	});

	it("allows authenticated user on public routes when requireLogin is true", () => {
		expect(resolveProxyAction(makeUrl("/"), forumSession(), null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), forumSession(), null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), forumSession(), null, true)).toBe("next");
	});

	it("always allows login pages even when requireLogin is true", () => {
		expect(resolveProxyAction(makeUrl("/login"), null, null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/register"), null, null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/admin/login"), null, null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/api/auth/signin"), null, null, true)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Non-public, non-admin, non-forum-auth routes (catch-all)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on unknown non-public route to /login", () => {
		expect(resolveProxyAction(makeUrl("/some-unknown-route"), null, null)).toBe("redirect:/login");
	});

	it("allows authenticated forum user on unknown non-public route", () => {
		expect(resolveProxyAction(makeUrl("/some-unknown-route"), forumSession(), null)).toBe("next");
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
