/**
 * Proxy — auth guard for forum + admin console.
 *
 * Uses Next.js 16 proxy convention (replaces middleware.ts).
 *
 * Route protection tiers:
 * 1. Public routes: /, /forums/*, /threads/*, /users/*, /digest, /search,
 *    /login, /admin/login, /api/auth/* — no auth required (unless require_login is enabled).
 * 2. Forum auth routes: /threads/new — requires forum credentials session.
 * 3. Admin routes: /admin/* (except /admin/login) — requires Google OAuth + ADMIN_EMAILS.
 * 4. API routes: /api/* (except /api/auth/*) — NOT handled by proxy;
 *    auth guard is in route handlers or lib/admin-proxy.ts instead.
 *
 * Feature flag: features.access.require_login
 * When enabled, all public forum routes require authentication.
 */

import { auth } from "@/auth";
import { isAdmin } from "@/lib/admin";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/** Routes that are always public (auth pages, API, static assets). */
function isAlwaysPublicRoute(pathname: string): boolean {
	// Auth endpoints are always accessible
	if (pathname === "/login" || pathname === "/admin/login" || pathname === "/register") return true;
	if (pathname.startsWith("/api/auth")) return true;
	return false;
}

/** Routes that are public unless require_login is enabled. */
export function isPublicRoute(pathname: string): boolean {
	// Always-public routes
	if (isAlwaysPublicRoute(pathname)) return true;

	// Forum public pages
	if (pathname === "/") return true;
	if (pathname === "/digest" || pathname === "/search") return true;
	if (pathname.startsWith("/forums/") || pathname === "/forums") return true;
	if (pathname.startsWith("/users/") || pathname === "/users") return true;

	// Thread pages are public except /threads/new
	if (pathname.startsWith("/threads/")) {
		return pathname !== "/threads/new";
	}
	if (pathname === "/threads") return true;

	return false;
}

/** Routes that require forum user authentication (credentials). */
export function isForumAuthRoute(pathname: string): boolean {
	return pathname === "/threads/new";
}

/** Check if a pathname is an admin page route (not API, not admin login). */
export function isAdminRoute(pathname: string): boolean {
	if (pathname === "/admin/login") return false;
	return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * Determine the proxy action for the given request state.
 *
 * Returns:
 * - "next"                    -> allow through
 * - "redirect:/admin"         -> redirect to admin dashboard
 * - "redirect:/login"         -> redirect to forum login
 * - "redirect:/admin/login"   -> redirect to admin login
 *
 * @param requireLogin - When true, all forum public routes require authentication
 */
export function resolveProxyAction(
	pathname: string,
	isLoggedIn: boolean,
	email?: string | null,
	provider?: string | null,
	requireLogin = false,
): "next" | "redirect:/" | "redirect:/admin" | "redirect:/login" | "redirect:/admin/login" {
	// Always-public routes (login, register, api/auth) are never blocked
	if (isAlwaysPublicRoute(pathname)) {
		// Authenticated admin on admin login page -> redirect to admin dashboard
		if (pathname === "/admin/login" && isLoggedIn && isAdmin(email)) return "redirect:/admin";

		// Credentials users already have a forum session — redirect away from auth pages
		if (
			(pathname === "/login" || pathname === "/register") &&
			isLoggedIn &&
			provider === "credentials"
		) {
			return "redirect:/";
		}

		return "next";
	}

	// If require_login is enabled, all forum content requires authentication
	if (requireLogin && isPublicRoute(pathname) && !isLoggedIn) {
		return "redirect:/login";
	}

	if (isPublicRoute(pathname)) {
		return "next";
	}

	// Forum auth routes: require credentials provider (Google OAuth users have no Worker JWT)
	if (isForumAuthRoute(pathname)) {
		if (!isLoggedIn || provider !== "credentials") return "redirect:/login";
		return "next";
	}

	// Admin page routes require admin whitelist check
	if (isAdminRoute(pathname)) {
		if (!isLoggedIn) return "redirect:/admin/login";
		if (!isAdmin(email)) return "redirect:/admin/login";
		return "next";
	}

	// Other non-public routes: require login
	if (!isLoggedIn) return "redirect:/login";

	return "next";
}

// ---------------------------------------------------------------------------
// Settings cache for require_login flag
// ---------------------------------------------------------------------------

let requireLoginCache: boolean | null = null;
let requireLoginCacheExpiry = 0;
const CACHE_TTL = 60000; // 1 minute

function getWorkerUrl(): string {
	const url = process.env.WORKER_API_URL;
	if (!url) {
		// Fallback: disable require_login if Worker URL not configured
		return "";
	}
	return url.replace(/\/+$/, "");
}

function getApiKey(): string {
	return process.env.FORUM_API_KEY || "";
}

async function getRequireLogin(): Promise<boolean> {
	// Return cached value if still valid
	if (requireLoginCache !== null && Date.now() < requireLoginCacheExpiry) {
		return requireLoginCache;
	}

	const workerUrl = getWorkerUrl();
	const apiKey = getApiKey();

	// If Worker not configured, disable require_login
	if (!workerUrl || !apiKey) {
		return false;
	}

	try {
		// Fetch directly from Worker API using prefix filter
		const res = await fetch(`${workerUrl}/api/v1/settings?prefix=features.access.require_login`, {
			headers: { "X-API-Key": apiKey },
			cache: "no-store",
		});
		if (!res.ok) return false;
		const data = await res.json();
		// API returns typed values: boolean true, not string "true"
		const value = data.data?.["features.access.require_login"];
		requireLoginCache = value === true || value === "true";
		requireLoginCacheExpiry = Date.now() + CACHE_TTL;
		return requireLoginCache;
	} catch {
		// On error, default to false (don't block access)
		return false;
	}
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
	// Fetch require_login setting (cached, from Worker API)
	const requireLogin = await getRequireLogin();

	const authHandler = await auth((req) => {
		const session = req.auth;
		// Extract provider from augmented session type
		// In proxy context, req.auth is the decoded session which includes our custom fields
		const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;
		const action = resolveProxyAction(
			req.nextUrl.pathname,
			!!session,
			session?.user?.email,
			provider,
			requireLogin,
		);

		if (action === "next") return NextResponse.next();
		const target = action.replace("redirect:", "");
		return NextResponse.redirect(buildRedirectUrl(req, target));
	});

	return authHandler(request, {} as never);
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$|api/(?!auth)).*)",
	],
};
