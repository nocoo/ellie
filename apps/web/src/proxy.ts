/**
 * Proxy — auth guard for admin-only console.
 *
 * Uses Next.js 16 proxy convention (replaces middleware.ts).
 *
 * Route protection:
 * - Public routes: /login, /api/auth/*  (no auth required)
 * - /admin/* page routes: requires Google OAuth session + email ∈ ADMIN_EMAILS
 * - /api/admin/* API routes: NOT handled by proxy (matcher excludes them);
 *   auth guard is in lib/admin-proxy.ts createProxyHandler() instead.
 */

import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/** Routes that are always public (no auth required). */
export function isPublicRoute(pathname: string): boolean {
	return pathname === "/login" || pathname.startsWith("/api/auth");
}

/** Check if a pathname is an admin page route (not API). */
export function isAdminRoute(pathname: string): boolean {
	return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Determine the proxy action for the given request state.
 *
 * Returns:
 * - "next"              -> allow through
 * - "redirect:/admin"   -> redirect to admin (logged-in admin on login page)
 * - "redirect:/login"   -> redirect to login (unauthenticated or non-admin user)
 */
export function resolveProxyAction(
	pathname: string,
	isLoggedIn: boolean,
	email?: string | null,
): "next" | "redirect:/admin" | "redirect:/login" {
	if (isPublicRoute(pathname)) {
		// Authenticated admin on login page -> redirect to admin
		if (pathname === "/login" && isLoggedIn && isAdmin(email)) return "redirect:/admin";
		return "next";
	}

	// Not logged in -> redirect to login
	if (!isLoggedIn) return "redirect:/login";

	// Admin page routes require admin whitelist check
	if (isAdminRoute(pathname) && !isAdmin(email)) return "redirect:/login";

	return "next";
}

// ---------------------------------------------------------------------------
// Build redirect URL respecting reverse proxy headers
// ---------------------------------------------------------------------------

export function buildRedirectUrl(req: NextRequest, pathname: string): URL {
	const forwardedHost = req.headers.get("x-forwarded-host");
	const forwardedProto = req.headers.get("x-forwarded-proto") || "https";

	if (forwardedHost) {
		return new URL(pathname, `${forwardedProto}://${forwardedHost}`);
	}

	return new URL(pathname, req.nextUrl.origin);
}

// ---------------------------------------------------------------------------
// Next.js 16 proxy convention
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
	const authHandler = await auth((req) => {
		const action = resolveProxyAction(req.nextUrl.pathname, !!req.auth, req.auth?.user?.email);

		if (action === "next") return NextResponse.next();
		const target = action === "redirect:/admin" ? "/admin" : "/login";
		return NextResponse.redirect(buildRedirectUrl(req, target));
	});

	return authHandler(request, {} as never);
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$|api/(?!auth)).*)",
	],
};
