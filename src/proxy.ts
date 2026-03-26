// proxy.ts — Route guard (Next.js 16 proxy pattern)
// Ref: 04b §路由守卫 — public/auth/admin route classification
//
// Next.js 16 replaces middleware.ts with proxy.ts.
// Uses NextAuth v5 wrapper pattern to read session from JWT cookie.
// Falls back to X-Mock-Uid/X-Mock-Role headers for API testing (curl).

import { auth } from "@/lib/auth-instance";
import { NextResponse } from "next/server";

/**
 * Route access level.
 */
export type RouteAccess = "public" | "auth" | "admin";

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

/**
 * Public routes — no authentication required.
 *
 * Exact matches and prefix matches (with trailing **).
 */
const PUBLIC_EXACT = new Set(["/", "/digest", "/login"]);
const PUBLIC_PREFIXES = ["/forums/", "/threads/", "/users/", "/search"];

/**
 * Auth-only routes — user must be logged in.
 */
const AUTH_EXACT = new Set(["/threads/new"]);

/**
 * Admin routes — user must have Admin or SuperMod role.
 */
const ADMIN_PREFIXES = ["/admin/", "/api/admin/"];

/**
 * API read routes — public GET access under /api/v1/.
 * Write operations are checked at the route handler level.
 */
const API_PUBLIC_PREFIX = "/api/v1/";

/**
 * NextAuth API routes — always public (handles login/logout/session).
 */
const AUTH_API_PREFIX = "/api/auth/";

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a URL pathname into its required access level.
 *
 * Pure function, exported for testing.
 *
 * Rules (evaluated in order):
 * 1. NextAuth API routes → "public" (must be accessible for login flow)
 * 2. Admin prefixes → "admin"
 * 3. Auth exact matches → "auth"
 * 4. Public exact matches → "public"
 * 5. Public prefixes → "public"
 * 6. API v1 prefix → "public" (write-check deferred to handler)
 * 7. Fallback → "auth" (deny by default)
 */
export function classifyRoute(pathname: string): RouteAccess {
	// 0. NextAuth API routes — must be public for login/logout to work
	if (pathname.startsWith(AUTH_API_PREFIX)) return "public";

	// 1. Admin routes (exact match on trimmed prefix, or startsWith prefix/)
	for (const prefix of ADMIN_PREFIXES) {
		const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
		if (pathname === base || pathname.startsWith(prefix)) return "admin";
	}

	// 2. Auth-only exact routes (must check before public prefixes)
	if (AUTH_EXACT.has(pathname)) return "auth";

	// 3. Public exact routes
	if (PUBLIC_EXACT.has(pathname)) return "public";

	// 4. Public prefix routes
	for (const prefix of PUBLIC_PREFIXES) {
		if (pathname.startsWith(prefix)) return "public";
	}

	// 5. API v1 — public (write checks at handler level)
	if (pathname.startsWith(API_PUBLIC_PREFIX)) return "public";

	// 6. Default: require authentication
	return "auth";
}

/**
 * Check if a route is publicly accessible.
 *
 * Pure function, exported for testing.
 */
export function isPublicRoute(pathname: string): boolean {
	return classifyRoute(pathname) === "public";
}

/**
 * Check if a route requires admin access.
 *
 * Pure function, exported for testing.
 */
export function isAdminRoute(pathname: string): boolean {
	return classifyRoute(pathname) === "admin";
}

/**
 * Check if a route requires authentication (but not admin).
 *
 * Pure function, exported for testing.
 */
export function isAuthRoute(pathname: string): boolean {
	return classifyRoute(pathname) === "auth";
}

// ---------------------------------------------------------------------------
// Next.js 16 proxy function (replaces middleware)
// ---------------------------------------------------------------------------

// Mock auth header names — fallback for API testing via curl/Postman.
const MOCK_UID_HEADER = "X-Mock-Uid";
const MOCK_ROLE_HEADER = "X-Mock-Role";
// Admin roles: Admin=1, SuperMod=2
const ADMIN_ROLE_VALUES = new Set([1, 2]);

/**
 * Next.js 16 proxy function — runs on every request.
 *
 * Auth strategy (dual-mode):
 *   1. Primary: NextAuth session cookie (JWT) — populated by auth() wrapper
 *   2. Fallback: X-Mock-Uid / X-Mock-Role headers — for API testing
 *
 * Route behavior:
 *   - "public" routes: pass through
 *   - "auth" routes: require authentication, redirect to /login if missing
 *   - "admin" routes: require auth + admin role, redirect/403 if missing
 */
export const proxy = auth((req) => {
	const { pathname } = req.nextUrl;
	const access = classifyRoute(pathname);

	if (access === "public") {
		return NextResponse.next();
	}

	// Check authentication — session cookie (primary) or header (fallback)
	const sessionUserId = req.auth?.user?.id;
	const headerUid = req.headers.get(MOCK_UID_HEADER);
	const isAuthenticated =
		(sessionUserId != null && sessionUserId !== "") || (headerUid != null && headerUid !== "");

	if (!isAuthenticated) {
		if (pathname.startsWith("/api/")) {
			return NextResponse.json({ error: "Authentication required" }, { status: 401 });
		}
		const loginUrl = req.nextUrl.clone();
		loginUrl.pathname = "/login";
		loginUrl.searchParams.set("callbackUrl", pathname);
		return NextResponse.redirect(loginUrl);
	}

	// Admin role check — session (primary) or header (fallback)
	if (access === "admin") {
		const sessionRole = (req.auth?.user as Record<string, unknown> | undefined)?.role;
		const headerRole = req.headers.get(MOCK_ROLE_HEADER);
		const role =
			sessionRole != null ? Number(sessionRole) : headerRole != null ? Number(headerRole) : null;

		if (role === null || !ADMIN_ROLE_VALUES.has(role)) {
			if (pathname.startsWith("/api/")) {
				return NextResponse.json({ error: "Forbidden: admin role required" }, { status: 403 });
			}
			// Page routes: redirect to home instead of showing JSON
			const homeUrl = req.nextUrl.clone();
			homeUrl.pathname = "/";
			return NextResponse.redirect(homeUrl);
		}
	}

	return NextResponse.next();
});

/**
 * Route matcher — only run proxy on matched routes.
 * Skip static assets and internal Next.js paths.
 */
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico|smileys/).*)"],
};
