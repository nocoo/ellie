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
import { resolveTrustedClientIp } from "@/lib/client-ip";
import { resolveLegacyDiscuzRedirect } from "@/lib/legacy-url";
import { createTtlCache } from "@/lib/ttl-cache";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";

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
// P5 — analytics page-view ingest (proxy-side)
// ---------------------------------------------------------------------------
//
// The proxy is the single attachment point: for every navigation that
// reaches a forum content page, it fires a fire-and-forget POST to the
// worker's `/api/internal/analytics/ingest`. The endpoint is gated by
// a shared secret (`ANALYTICS_INGEST_KEY`), so the secret MUST live in
// the Next runtime environment ONLY — never `NEXT_PUBLIC_*`. The proxy
// is also the place where we resolve the trusted client IP, because
// `cf-connecting-ip` is only attached at the edge and may not survive
// further downstream rewriting.
//
// Path-kind classification mirrors the worker's strict whitelist (the
// 10-bucket `PathKind` enum); paths that do NOT classify into a known
// bucket are dropped (we do NOT forward "other" for static / api /
// asset prefixes — the matcher already filters those, see `config`).

type PathKind =
	| "thread"
	| "forum"
	| "user"
	| "home"
	| "digest"
	| "search"
	| "checkin"
	| "messages"
	| "auth_page"
	| "other";

/**
 * Classify a pathname into a coarse page bucket. Returns `null` when
 * the path should NOT be ingested (static assets, api routes, auth API
 * callbacks). The proxy matcher already excludes `_next/*`, favicon
 * and image assets — this is a second gate so the ingest payload set
 * stays narrow and reviewable.
 *
 * Numeric `targetId` is extracted for the three id-bearing buckets
 * (thread / forum / user); all other buckets are recorded with
 * `targetId = 0`. A non-numeric id (e.g. `/threads/new`) maps the
 * navigation to its semantic page (thread page WITHOUT an id is the
 * compose-new page, which we count as `other`).
 */
/**
 * Extract a strictly positive integer id from a `/<prefix>/<id>[/...]`
 * tail. Returns 0 when the first segment is missing, non-numeric, or
 * non-positive. Used by id-bearing buckets (thread / forum / user) so
 * their classification stays a single helper call.
 */
function parseLeadingId(rest: string): number {
	const idPart = rest.split("/")[0] ?? "";
	if (!/^\d+$/.test(idPart)) return 0;
	const n = Number.parseInt(idPart, 10);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Map id-bearing prefixes (`/threads/`, `/forums/`, `/users/`) to their
 * canonical PathKind plus the positive integer id. A missing or
 * non-numeric id (e.g. `/threads/new`) falls back to the `other` bucket
 * so the compose-new page is NOT counted as a thread view.
 */
function classifyIdBearing(pathname: string): { kind: PathKind; targetId: number } | null {
	const prefixes: Array<[string, PathKind]> = [
		["/threads/", "thread"],
		["/forums/", "forum"],
		["/users/", "user"],
	];
	for (const [prefix, kind] of prefixes) {
		if (pathname.startsWith(prefix)) {
			const id = parseLeadingId(pathname.slice(prefix.length));
			return id > 0 ? { kind, targetId: id } : { kind: "other", targetId: 0 };
		}
	}
	return null;
}

/**
 * Static-prefix buckets without a numeric id. Each entry maps a stable
 * prefix (root + sub-tree) to its PathKind.
 */
const STATIC_BUCKETS: ReadonlyArray<readonly [string, PathKind]> = [
	["/digest", "digest"],
	["/search", "search"],
	["/checkin", "checkin"],
	["/messages", "messages"],
];

function classifyStaticBucket(pathname: string): { kind: PathKind; targetId: number } | null {
	for (const [prefix, kind] of STATIC_BUCKETS) {
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
			return { kind, targetId: 0 };
		}
	}
	return null;
}

/**
 * Known bare-container pages without a numeric id (index pages of the
 * id-bearing prefixes). Listed explicitly so an unknown root such as
 * `/random` does NOT silently land in `other` — D0 v2 fail-closed gate.
 */
const KNOWN_BARE_CONTAINERS: ReadonlySet<string> = new Set(["/threads", "/forums", "/users"]);

export function classifyPathKind(pathname: string): { kind: PathKind; targetId: number } | null {
	// Skip api / auth-callback / static-ish prefixes outright (defense-in-
	// depth: the matcher excludes most of these, but a typo or new asset
	// dir shouldn't accidentally start emitting samples).
	if (pathname.startsWith("/api/") || pathname.startsWith("/_next/")) return null;

	if (pathname === "/login" || pathname === "/register") {
		return { kind: "auth_page", targetId: 0 };
	}
	if (pathname === "/" || pathname === "") {
		return { kind: "home", targetId: 0 };
	}

	const staticHit = classifyStaticBucket(pathname);
	if (staticHit) return staticHit;

	const idHit = classifyIdBearing(pathname);
	if (idHit) return idHit;

	// Known bare-container index pages (e.g. /threads, /forums, /users)
	// fall into `other` so we still see "container hits" without an id.
	if (KNOWN_BARE_CONTAINERS.has(pathname)) {
		return { kind: "other", targetId: 0 };
	}

	// D0 v2 fail-closed: unknown roots (e.g. /random, future /admin/*
	// proxied through the forum app by mistake) do NOT emit a sample.
	// Adding a new public page requires an explicit allowlist entry.
	return null;
}

/** Body shape sent to the worker — STRICT whitelist. Adding a field
 *  here requires a matching update on the worker's
 *  `ALLOWED_BODY_KEYS` whitelist; otherwise the worker returns 400. */
export interface IngestBody {
	path_kind: PathKind;
	target_id: number;
	user_id: number;
}

/**
 * Build the ingest payload from a resolved (pathname, userId). The
 * `userId` MUST be 0 for anonymous viewers; we explicitly do NOT
 * accept a forwarded value from the request (the proxy resolves it
 * server-side via `auth()` and is the single source of truth).
 */
export function buildIngestPayload(pathname: string, userId: number): IngestBody | null {
	const cls = classifyPathKind(pathname);
	if (!cls) return null;
	return {
		path_kind: cls.kind,
		target_id: cls.targetId,
		user_id: Number.isFinite(userId) && userId > 0 ? Math.floor(userId) : 0,
	};
}

/**
 * Resolve the worker base URL + ingest secret from the Next runtime
 * environment. Both MUST be server-only (no `NEXT_PUBLIC_*`). Returns
 * null when either is missing — the caller then drops the sample
 * silently (P5 is opportunistic and never blocks navigation).
 */
function getIngestConfig(): { url: string; key: string } | null {
	const workerUrl = (process.env.WORKER_API_URL ?? "").replace(/\/+$/, "");
	const key = process.env.ANALYTICS_INGEST_KEY ?? "";
	if (!workerUrl || !key) return null;
	return { url: `${workerUrl}/api/internal/analytics/ingest`, key };
}

/**
 * Fire-and-forget POST to the worker ingest endpoint. Returns a
 * `Promise<void>` that the caller hands to `event.waitUntil(...)`.
 *
 * Failure modes are silently swallowed: P5 is observability, not a
 * trust-edge. A worker outage or a 4xx MUST NOT bubble up into the
 * user-facing navigation.
 */
export async function tryRecordPageView(args: {
	pathname: string;
	userId: number;
	clientIp: string;
	userAgent: string;
}): Promise<void> {
	const cfg = getIngestConfig();
	if (!cfg) return;
	const body = buildIngestPayload(args.pathname, args.userId);
	if (!body) return;
	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Ingest-Key": cfg.key,
		};
		if (args.clientIp) headers["X-Ellie-Client-IP"] = args.clientIp;
		if (args.userAgent) headers["User-Agent"] = args.userAgent;
		const res = await fetch(cfg.url, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			cache: "no-store",
			signal: AbortSignal.timeout(5000),
		});
		await res.body?.cancel();
	} catch {
		// Swallow — observability MUST NOT throw on the request hot path.
	}
}

// ---------------------------------------------------------------------------
// Next.js 16 proxy convention
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest, event?: NextFetchEvent) {
	// Legacy Discuz URL → canonical path-segment URL. MUST run BEFORE
	// auth() / require_login / analytics so legacy hits never trigger
	// session lookups or page-view ingest (they're pre-content). The
	// helper is pure: it only inspects the URL and decides if a 301
	// applies. Unknown / canonical URLs return null and we fall
	// through to the normal proxy flow.
	const legacy = resolveLegacyDiscuzRedirect(request.nextUrl);
	if (legacy) {
		return NextResponse.redirect(new URL(legacy.destination, request.nextUrl.origin), 301);
	}

	// Fetch require_login setting (cached, from Worker API)
	const requireLogin = await getRequireLogin();

	// Get forum session
	const forumSession = await auth();

	const action = resolveProxyAction(request.nextUrl, forumSession, requireLogin);

	if (action === "next") {
		const clientIp = resolveTrustedClientIp(request);
		if (event) {
			const userId = resolveForumUserId(forumSession);
			const userAgent = request.headers.get("user-agent") ?? "";
			event.waitUntil(
				tryRecordPageView({
					pathname: request.nextUrl.pathname,
					userId,
					clientIp,
					userAgent,
				}),
			);
		}
		const requestHeaders = new Headers(request.headers);
		if (clientIp) {
			requestHeaders.set("x-forwarded-client-ip", clientIp);
		} else {
			requestHeaders.delete("x-forwarded-client-ip");
		}
		return NextResponse.next({ request: { headers: requestHeaders } });
	}
	const target = action.replace("redirect:", "");
	return NextResponse.redirect(buildRedirectUrl(request, target));
}

/**
 * Resolve the forum user id from the session. The session's
 * `user.name` is the username; the numeric id lives at
 * `session.user.id` when the credentials provider sets it. Anonymous
 * navigation resolves to 0.
 *
 * D0 v2 / reviewer pin: this MUST be credentials-only. A future
 * Google/OAuth session may carry a numeric id that does NOT correspond
 * to a forum user_id — accepting it would poison analytics with the
 * wrong identity. Sessions whose `provider` is missing or anything
 * other than `"credentials"` resolve to 0 (anonymous), regardless of
 * the id value.
 */
export function resolveForumUserId(
	session: { user?: { id?: string | number | null; provider?: string | null } } | null,
): number {
	if (session?.user?.provider !== "credentials") return 0;
	const raw = session.user.id;
	if (raw === null || raw === undefined) return 0;
	const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
	return Number.isFinite(n) && n > 0 ? n : 0;
}

export const config = {
	matcher: [
		"/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.ico$|.*\\.svg$|api/(?!auth)).*)",
	],
};
