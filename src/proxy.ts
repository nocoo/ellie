// proxy.ts — Route guard (Next.js 16 proxy pattern)
// Ref: 04b §路由守卫 — public/auth/admin route classification
//
// Next.js 16 replaces middleware.ts with proxy.ts.
// Exports the required `proxy` function + pure classification helpers.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a URL pathname into its required access level.
 *
 * Pure function, exported for testing.
 *
 * Rules (evaluated in order):
 * 1. Admin prefixes → "admin"
 * 2. Auth exact matches → "auth"
 * 3. Public exact matches → "public"
 * 4. Public prefixes → "public"
 * 5. API v1 prefix → "public" (write-check deferred to handler)
 * 6. Fallback → "auth" (deny by default)
 */
export function classifyRoute(pathname: string): RouteAccess {
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

/**
 * Next.js 16 proxy function — runs on every request.
 *
 * Mock phase: pass-through (no auth enforcement).
 * Phase 2: redirect unauthenticated users to /login for auth routes,
 *          return 403 for admin routes without admin role.
 */
export function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;
	const access = classifyRoute(pathname);

	// Mock phase: log classification but don't enforce
	// Phase 2: check session and enforce access control
	if (access === "admin" || access === "auth") {
		// Pass through for now — enforcement comes in Phase 2
	}

	return NextResponse.next();
}

/**
 * Route matcher — only run proxy on matched routes.
 * Skip static assets and internal Next.js paths.
 */
export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico|smileys/).*)"],
};
