import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
	default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({
	default: vi.fn(),
}));
vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));
vi.mock("next/server", () => ({
	NextResponse: {
		redirect: vi.fn((url: URL) => ({ type: "redirect", url })),
		next: vi.fn(() => ({ type: "next" })),
	},
}));

// Must mock @/auth to control what auth() returns in proxy()
const mockAuth = vi.fn(async () => null);
vi.mock("@/auth", () => ({
	auth: () => mockAuth(),
}));

import {
	buildRedirectUrl,
	isForumAuthRoute,
	isMessagesRoute,
	isPublicRoute,
	proxy,
	resolveProxyAction,
} from "@/proxy";

/** Helper to create a URL object for testing resolveProxyAction */
function makeUrl(pathname: string, search = ""): URL {
	return new URL(`${pathname}${search}`, "https://example.com");
}

/** Helper to create forum session */
function forumSession(name = "testuser") {
	return { user: { name } };
}

// ---------------------------------------------------------------------------
// isPublicRoute
// ---------------------------------------------------------------------------

describe("isPublicRoute", () => {
	it("marks /login as public (forum login)", () => {
		expect(isPublicRoute("/login")).toBe(true);
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

	it("returns false for /threads/new", () => {
		expect(isMessagesRoute("/threads/new")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// resolveProxyAction
// ---------------------------------------------------------------------------

describe("resolveProxyAction", () => {
	// -----------------------------------------------------------------------
	// Public routes
	// -----------------------------------------------------------------------

	it("allows public routes for unauthenticated users", () => {
		expect(resolveProxyAction(makeUrl("/login"), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/api/auth/signin"), null)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Forum public routes
	// -----------------------------------------------------------------------

	it("allows unauthenticated users on forum public routes", () => {
		expect(resolveProxyAction(makeUrl("/"), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/users/42"), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/digest"), null)).toBe("next");
		expect(resolveProxyAction(makeUrl("/search"), null)).toBe("next");
	});

	it("allows authenticated users on forum public routes", () => {
		expect(resolveProxyAction(makeUrl("/"), forumSession())).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), forumSession())).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), forumSession())).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Forum auth routes (/threads/new)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on /threads/new to /login", () => {
		expect(resolveProxyAction(makeUrl("/threads/new"), null)).toBe("redirect:/login");
	});

	it("allows authenticated forum user on /threads/new", () => {
		expect(resolveProxyAction(makeUrl("/threads/new"), forumSession())).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Messages routes (special handling)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on /messages to /login with redirect param", () => {
		const result = resolveProxyAction(makeUrl("/messages"), null);
		expect(result).toBe("redirect:/login?redirect=%2Fmessages");
	});

	it("redirects unauthenticated user on /messages with query to /login preserving query", () => {
		const result = resolveProxyAction(makeUrl("/messages", "?to=123"), null);
		expect(result).toBe("redirect:/login?redirect=%2Fmessages%3Fto%3D123");
	});

	it("allows forum user on /messages", () => {
		expect(resolveProxyAction(makeUrl("/messages"), forumSession())).toBe("next");
	});

	it("allows forum user on /messages/123", () => {
		expect(resolveProxyAction(makeUrl("/messages/123"), forumSession())).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Credentials user redirect from /login and /register
	// -----------------------------------------------------------------------

	it("redirects forum user on /login to /", () => {
		expect(resolveProxyAction(makeUrl("/login"), forumSession())).toBe("redirect:/");
	});

	it("redirects forum user on /register to /", () => {
		expect(resolveProxyAction(makeUrl("/register"), forumSession())).toBe("redirect:/");
	});

	it("allows unauthenticated user on /login", () => {
		expect(resolveProxyAction(makeUrl("/login"), null)).toBe("next");
	});

	it("allows unauthenticated user on /register", () => {
		expect(resolveProxyAction(makeUrl("/register"), null)).toBe("next");
	});

	it("does not redirect forum user on other public routes like /forums", () => {
		expect(resolveProxyAction(makeUrl("/forums"), forumSession())).toBe("next");
		expect(resolveProxyAction(makeUrl("/"), forumSession())).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), forumSession())).toBe("next");
	});

	// -----------------------------------------------------------------------
	// require_login feature flag
	// -----------------------------------------------------------------------

	it("allows unauthenticated user on public routes when requireLogin is false", () => {
		expect(resolveProxyAction(makeUrl("/"), null, false)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), null, false)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), null, false)).toBe("next");
	});

	it("redirects unauthenticated user on public routes when requireLogin is true", () => {
		expect(resolveProxyAction(makeUrl("/"), null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/forums/10"), null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/threads/123"), null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/digest"), null, true)).toBe("redirect:/login");
		expect(resolveProxyAction(makeUrl("/search"), null, true)).toBe("redirect:/login");
	});

	it("allows authenticated user on public routes when requireLogin is true", () => {
		expect(resolveProxyAction(makeUrl("/"), forumSession(), true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/forums/10"), forumSession(), true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/threads/123"), forumSession(), true)).toBe("next");
	});

	it("always allows login pages even when requireLogin is true", () => {
		expect(resolveProxyAction(makeUrl("/login"), null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/register"), null, true)).toBe("next");
		expect(resolveProxyAction(makeUrl("/api/auth/signin"), null, true)).toBe("next");
	});

	// -----------------------------------------------------------------------
	// Non-public, non-forum-auth routes (catch-all)
	// -----------------------------------------------------------------------

	it("redirects unauthenticated user on unknown non-public route to /login", () => {
		expect(resolveProxyAction(makeUrl("/some-unknown-route"), null)).toBe("redirect:/login");
	});

	it("allows authenticated forum user on unknown non-public route", () => {
		expect(resolveProxyAction(makeUrl("/some-unknown-route"), forumSession())).toBe("next");
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
		const result = buildRedirectUrl(req, "/login");
		expect(result.href).toBe("https://proxy.example.com/login");
	});

	it("uses x-forwarded-host with https proto when x-forwarded-proto is missing", () => {
		const req = makeMockRequest("https://app.example.com/path", {
			"x-forwarded-host": "proxy.example.com",
		});
		const result = buildRedirectUrl(req, "/login");
		expect(result.href).toBe("https://proxy.example.com/login");
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
		const result = buildRedirectUrl(req, "/login");
		expect(result.href).toBe("http://proxy.example.com/login");
	});
});

// ---------------------------------------------------------------------------
// proxy() integration tests
// ---------------------------------------------------------------------------

describe("proxy", () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = { ...process.env };

	function makeMockNextRequest(pathname: string, search = "") {
		const url = new URL(`${pathname}${search}`, "https://example.com");
		return {
			headers: { get: () => null },
			nextUrl: url,
		} as any;
	}

	beforeEach(() => {
		vi.clearAllMocks();
		process.env.WORKER_API_URL = "https://worker.example.com";
		process.env.FORUM_API_KEY = "test-key";
		// Mock fetch to return require_login = false
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ data: { "features.access.require_login": false } }), {
					status: 200,
				}),
		) as any;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env.WORKER_API_URL = originalEnv.WORKER_API_URL;
		process.env.FORUM_API_KEY = originalEnv.FORUM_API_KEY;
	});

	it("returns next for public route when unauthenticated", async () => {
		mockAuth.mockResolvedValue(null);
		const result = await proxy(makeMockNextRequest("/"));
		expect(result.type).toBe("next");
	});

	it("returns redirect for auth-required route when unauthenticated", async () => {
		mockAuth.mockResolvedValue(null);
		const result = await proxy(makeMockNextRequest("/threads/new"));
		expect(result.type).toBe("redirect");
	});

	it("returns next for auth-required route when authenticated", async () => {
		mockAuth.mockResolvedValue({ user: { name: "user" } });
		const result = await proxy(makeMockNextRequest("/threads/new"));
		expect(result.type).toBe("next");
	});

	it("returns next when Worker API is not configured", async () => {
		process.env.WORKER_API_URL = "";
		process.env.FORUM_API_KEY = "";
		mockAuth.mockResolvedValue(null);
		const result = await proxy(makeMockNextRequest("/"));
		expect(result.type).toBe("next");
	});

	it("returns next when settings fetch fails", async () => {
		globalThis.fetch = vi.fn(async () => {
			throw new Error("network");
		}) as any;
		mockAuth.mockResolvedValue(null);
		const result = await proxy(makeMockNextRequest("/"));
		expect(result.type).toBe("next");
	});

	it("returns redirect for messages route when unauthenticated", async () => {
		mockAuth.mockResolvedValue(null);
		const result = await proxy(makeMockNextRequest("/messages"));
		expect(result.type).toBe("redirect");
	});
});
