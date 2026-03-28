/**
 * Proxy — simplified auth guard for admin-only console.
 *
 * Uses Next.js 16 proxy convention (replaces middleware.ts).
 * Public routes: /login, /api/auth/*
 * Everything else requires authentication.
 */

import { auth } from "@/auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/** Routes that are always public (no auth required). */
export function isPublicRoute(pathname: string): boolean {
	return pathname === "/login" || pathname.startsWith("/api/auth");
}

/**
 * Determine the proxy action for the given request state.
 *
 * Returns:
 * - "next"              -> allow through
 * - "redirect:/admin"   -> redirect to admin (logged-in user on login page)
 * - "redirect:/login"   -> redirect to login (unauthenticated user)
 */
export function resolveProxyAction(
	pathname: string,
	isLoggedIn: boolean,
): "next" | "redirect:/admin" | "redirect:/login" {
	if (isPublicRoute(pathname)) {
		// Authenticated user on login page -> redirect to admin
		if (pathname === "/login" && isLoggedIn) return "redirect:/admin";
		return "next";
	}
	if (!isLoggedIn) return "redirect:/login";
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
		const action = resolveProxyAction(req.nextUrl.pathname, !!req.auth);

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
