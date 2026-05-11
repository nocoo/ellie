/**
 * Proxy — auth guard for forum routes.
 *
 * Uses Next.js 16 proxy convention (replaces middleware.ts).
 *
 * Route protection tiers:
 * 1. Public routes: /, /forums/*, /threads/*, /users/*, /digest, /search,
 *    /login — no auth required (unless require_login is enabled).
 * 2. Forum auth routes: /threads/new — requires forum credentials session.
 * 3. Messages routes: /messages/* — requires forum login.
 * 4. API routes: /api/* (except /api/auth/*) — NOT handled by proxy;
 *    auth guard is in route handlers instead.
 *
 * Feature flag: features.access.require_login
 * When enabled, all public forum routes require authentication.
 */

import { auth } from "@/auth";
import { createTtlCache } from "@/lib/ttl-cache";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/** Routes that are always public (auth pages, API, static assets). */
function isAlwaysPublicRoute(pathname: string): boolean {
	// Auth endpoints are always accessible
	if (pathname === "/login" || pathname === "/register") return true;
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

/** Routes that require credentials login but allow Google OAuth users to reach layout for notice. */
export function isMessagesRoute(pathname: string): boolean {
	return pathname === "/messages" || pathname.startsWith("/messages/");
}

/**
 * Determine the proxy action for the given request state.
 *
 * Returns:
 * - "next"                    -> allow through
 * - "redirect:/login"         -> redirect to forum login
 * - "redirect:/login?redirect=..." -> redirect with return URL
 *
 * @param nextUrl - Full URL object (for building redirect params)
 * @param forumSession - Forum user session (Credentials provider)
 * @param requireLogin - When true, all forum public routes require authentication
 */
export function resolveProxyAction(
	nextUrl: URL,
	forumSession: { user?: { name?: string | null } } | null,
	requireLogin = false,
): string {
	const pathname = nextUrl.pathname;
	const isForumLoggedIn = !!forumSession?.user;

	// Always-public routes (login, register, api/auth) are never blocked
	if (isAlwaysPublicRoute(pathname)) {
		// /register: credentials users already have a session — redirect away
		if (pathname === "/register" && isForumLoggedIn) {
			return "redirect:/";
		}

		// /login: let page.tsx handle (shows "已登录" card or login form)
		return "next";
	}

	// If require_login is enabled, all forum content requires authentication
	if (requireLogin && isPublicRoute(pathname) && !isForumLoggedIn) {
		return "redirect:/login";
	}

	if (isPublicRoute(pathname)) {
		return "next";
	}

	// Messages routes: special handling - require forum login
	if (isMessagesRoute(pathname)) {
		if (!isForumLoggedIn) {
			// Not logged in → redirect to login with return URL
			const target = pathname + nextUrl.search;
			return `redirect:/login?redirect=${encodeURIComponent(target)}`;
		}
		return "next";
	}

	// Forum auth routes: require forum credentials session
	if (isForumAuthRoute(pathname)) {
		if (!isForumLoggedIn) return "redirect:/login";
		return "next";
	}

	// Other non-public routes: require forum login
	if (!isForumLoggedIn) return "redirect:/login";

	return "next";
}

// ---------------------------------------------------------------------------
// Settings cache for require_login flag
// ---------------------------------------------------------------------------
//
// Phase B: cache state lives in `lib/ttl-cache`. Tests reset it via
// the exported `clearRequireLoginCacheForTests()`.

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

async function loadRequireLogin(): Promise<boolean> {
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
		return value === true || value === "true";
	} catch {
		// On error, default to false (don't block access)
		return false;
	}
}

const requireLoginSettingCache = createTtlCache<boolean>({
	expirationMs: 60_000,
	load: () => loadRequireLogin(),
});

async function getRequireLogin(): Promise<boolean> {
	return requireLoginSettingCache.get();
}

/** Test-only: drop the cached require_login value so the next call reloads. */
export function clearRequireLoginCacheForTests(): void {
	requireLoginSettingCache.clear();
}

// ---------------------------------------------------------------------------
// Build redirect URL — origin is taken from `req.nextUrl` only.
// ---------------------------------------------------------------------------
//
// Trusting `x-forwarded-host` / `x-forwarded-proto` here would be an open
// redirect: any client can set those request headers, so an attacker could
// craft a request to a public endpoint (e.g. `/threads/new` while logged out)
// with `X-Forwarded-Host: evil.example.com` and have us emit a 3xx Location
// pointing at `https://evil.example.com/login`. Browsers follow the Location
// blindly. The user lands on attacker infrastructure that mimics our login
// page.
//
// `req.nextUrl.origin` is derived by Next.js from the host the runtime is
// actually serving (and overridable at deploy time via NEXT_PUBLIC_* /
// trustHost config), not from arbitrary request headers — so we use it
// exclusively. If a deployment ever needs to honor an upstream proxy's
// host, it must be configured at the runtime layer, not inferred from
// request headers in app code.

export function buildRedirectUrl(req: NextRequest, pathname: string): URL {
	return new URL(pathname, req.nextUrl.origin);
}

// ---------------------------------------------------------------------------
// Next.js 16 proxy convention
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
	// Fetch require_login setting (cached, from Worker API)
	const requireLogin = await getRequireLogin();

	// Get forum session
	const forumSession = await auth();

	const action = resolveProxyAction(request.nextUrl, forumSession, requireLogin);

	if (action === "next") return NextResponse.next();
	const target = action.replace("redirect:", "");
	return NextResponse.redirect(buildRedirectUrl(request, target));
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$|api/(?!auth)).*)",
	],
};
