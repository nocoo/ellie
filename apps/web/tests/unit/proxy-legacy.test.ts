// proxy-legacy.test.ts — integration test for the legacy URL redirect
// path mounted at the top of `proxy()`.
//
// Reviewer pin (msg 8e2e3d01 / 56498717): the helper MUST run BEFORE
// `auth()` / `require_login` / analytics ingest so legacy hits never
// trigger session lookups or page-view ingest. This file proves that.
//
// Coverage:
//   - All 4 legacy shapes 301 to canonical path-segment URLs
//   - Query-page canonicalize (E/F) 301s in proxy
//   - /forums/:id/1 and /threads/:id/1 single-hop 301 to bare path
//   - Canonical URLs (`/forums/306`, `/forums/306/2`) fall through
//   - When the helper 301s, `auth()` is NOT called and `event.waitUntil`
//     (analytics ingest) is NOT triggered

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — auth, next-auth providers, next/server, and the analytics hook
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
	auth: vi.fn(async () => null as null | { user?: unknown }),
	redirect: vi.fn((url: URL, status?: number) => ({ type: "redirect", url, status })),
	next: vi.fn(() => ({ type: "next" })),
}));

vi.mock("next-auth", () => ({
	default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/server", () => ({
	NextResponse: {
		redirect: mocks.redirect,
		next: mocks.next,
	},
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/client-ip", () => ({ resolveTrustedClientIp: () => "" }));

import { proxy } from "@/proxy";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

const ORIGIN = "https://example.com";

function makeRequest(path: string) {
	const url = new URL(path, ORIGIN);
	return {
		nextUrl: url,
		headers: new Headers(),
	} as unknown as Parameters<typeof proxy>[0];
}

function makeEvent() {
	return { waitUntil: vi.fn() } as unknown as Parameters<typeof proxy>[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
	mocks.auth.mockResolvedValue(null);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("proxy() legacy 301 — shape A: /forum-:fid-:page.html", () => {
	it("page 1 → 301 to /forums/:fid (bare)", async () => {
		const res = (await proxy(makeRequest("/forum-306-1.html"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/forums/306");
	});

	it("page >= 2 → 301 to /forums/:fid/:page", async () => {
		const res = (await proxy(makeRequest("/forum-306-3.html"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/forums/306/3");
	});
});

describe("proxy() legacy 301 — shape B: /thread-:tid-:page-:extra.html", () => {
	it("page 1 → bare /threads/:tid (extra dropped, no returnTo)", async () => {
		const res = (await proxy(makeRequest("/thread-276060-1-1.html"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/threads/276060");
	});

	it("page >= 2 → /threads/:tid/:page", async () => {
		const res = (await proxy(makeRequest("/thread-276060-3-999.html"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/threads/276060/3");
	});
});

describe("proxy() legacy 301 — shape C: /forum.php?mod=forumdisplay", () => {
	it("no page → bare /forums/:fid", async () => {
		const res = (await proxy(makeRequest("/forum.php?mod=forumdisplay&fid=134"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/forums/134");
	});

	it("page >= 2 → /forums/:fid/:page (junk dropped)", async () => {
		const res = (await proxy(
			makeRequest("/forum.php?mod=forumdisplay&fid=134&page=4&mobile=2&from=portal&typeId=11"),
		)) as { url: URL; status: number };
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/forums/134/4");
	});
});

describe("proxy() legacy 301 — shape D: /forum.php?mod=viewthread", () => {
	it("fid present → adds percent-encoded returnTo", async () => {
		const res = (await proxy(
			makeRequest("/forum.php?mod=viewthread&tid=923066&page=2&fid=306"),
		)) as { url: URL; status: number };
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/threads/923066/2?returnTo=%2Fforums%2F306");
	});

	it("no explicit fid → no returnTo (extra never honored)", async () => {
		const res = (await proxy(
			makeRequest("/forum.php?mod=viewthread&tid=923066&extra=page%3D1"),
		)) as { url: URL; status: number };
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/threads/923066");
	});
});

describe("proxy() legacy 301 — query-page canonicalize", () => {
	it("/forums/:fid?page=2 → /forums/:fid/2", async () => {
		const res = (await proxy(makeRequest("/forums/306?page=2"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/forums/306/2");
	});

	it("/threads/:tid?page=1 → bare /threads/:tid", async () => {
		const res = (await proxy(makeRequest("/threads/923066?page=1"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/threads/923066");
	});
});

describe("proxy() legacy 301 — /forums/:id/1 and /threads/:id/1", () => {
	it("/forums/306/1 → /forums/306 (page=1 never canonical)", async () => {
		const res = (await proxy(makeRequest("/forums/306/1"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/forums/306");
	});

	it("/threads/923066/1 → /threads/923066", async () => {
		const res = (await proxy(makeRequest("/threads/923066/1"))) as {
			url: URL;
			status: number;
		};
		expect(res.status).toBe(301);
		expect(res.url.pathname + res.url.search).toBe("/threads/923066");
	});
});

describe("proxy() legacy 301 — canonical URLs fall through", () => {
	it("/forums/306 falls through (calls auth, returns next)", async () => {
		const res = await proxy(makeRequest("/forums/306"));
		expect(res).toEqual({ type: "next" });
		expect(mocks.auth).toHaveBeenCalled();
	});

	it("/forums/306/2 falls through (alias route renders)", async () => {
		const res = await proxy(makeRequest("/forums/306/2"));
		expect(res).toEqual({ type: "next" });
		expect(mocks.auth).toHaveBeenCalled();
	});

	it("/threads/923066/3 falls through (alias route renders)", async () => {
		const res = await proxy(makeRequest("/threads/923066/3"));
		expect(res).toEqual({ type: "next" });
		expect(mocks.auth).toHaveBeenCalled();
	});
});

describe("proxy() legacy 301 — runs BEFORE auth() / analytics", () => {
	it("legacy hit does NOT call auth()", async () => {
		await proxy(makeRequest("/forum-306-2.html"));
		expect(mocks.auth).not.toHaveBeenCalled();
	});

	it("legacy hit does NOT trigger event.waitUntil (analytics ingest)", async () => {
		const event = makeEvent();
		await proxy(makeRequest("/forum-306-2.html"), event);
		expect((event as { waitUntil: ReturnType<typeof vi.fn> }).waitUntil).not.toHaveBeenCalled();
	});

	it("legacy hit returns the redirect from NextResponse.redirect with 301", async () => {
		await proxy(makeRequest("/forum-306-2.html"));
		expect(mocks.redirect).toHaveBeenCalledTimes(1);
		const [, status] = mocks.redirect.mock.calls[0];
		expect(status).toBe(301);
	});
});
