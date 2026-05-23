// proxy-analytics.test.ts — P5 web proxy analytics ingest tests.
//
// Coverage:
//   - classifyPathKind: thread/forum/user with numeric id; home/digest/
//     search/checkin/messages/auth_page; non-numeric id → other;
//     /api/* and /_next/* → null (drop).
//   - buildIngestPayload: serializes the resolved bucket, normalizes
//     anonymous userId to 0, never carries negative/non-integer user_id.
//   - tryRecordPageView: requires both WORKER_API_URL +
//     ANALYTICS_INGEST_KEY to dispatch; posts to the canonical
//     `/api/internal/analytics/ingest` URL with
//     X-Ingest-Key + X-Real-IP + User-Agent headers; swallows fetch
//     errors silently (observability MUST NOT throw on the hot path).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
	default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({
	default: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("next/server", () => ({
	NextResponse: {
		redirect: vi.fn((url: URL) => ({ type: "redirect", url })),
		next: vi.fn(() => ({ type: "next" })),
	},
}));
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

import { buildIngestPayload, classifyPathKind, tryRecordPageView } from "@/proxy";

describe("classifyPathKind", () => {
	it("returns null for /api/* paths", () => {
		expect(classifyPathKind("/api/auth/signin")).toBeNull();
		expect(classifyPathKind("/api/anything")).toBeNull();
	});

	it("returns null for /_next/* assets", () => {
		expect(classifyPathKind("/_next/static/chunks/main.js")).toBeNull();
	});

	it("classifies the home page", () => {
		expect(classifyPathKind("/")).toEqual({ kind: "home", targetId: 0 });
	});

	it("classifies the auth pages", () => {
		expect(classifyPathKind("/login")).toEqual({ kind: "auth_page", targetId: 0 });
		expect(classifyPathKind("/register")).toEqual({ kind: "auth_page", targetId: 0 });
	});

	it("classifies digest/search/checkin/messages", () => {
		expect(classifyPathKind("/digest")).toEqual({ kind: "digest", targetId: 0 });
		expect(classifyPathKind("/search")).toEqual({ kind: "search", targetId: 0 });
		expect(classifyPathKind("/checkin")).toEqual({ kind: "checkin", targetId: 0 });
		expect(classifyPathKind("/messages")).toEqual({ kind: "messages", targetId: 0 });
		expect(classifyPathKind("/messages/inbox")).toEqual({ kind: "messages", targetId: 0 });
	});

	it("extracts numeric ids for thread/forum/user", () => {
		expect(classifyPathKind("/threads/42")).toEqual({ kind: "thread", targetId: 42 });
		expect(classifyPathKind("/threads/42/anything")).toEqual({ kind: "thread", targetId: 42 });
		expect(classifyPathKind("/forums/7")).toEqual({ kind: "forum", targetId: 7 });
		expect(classifyPathKind("/users/123")).toEqual({ kind: "user", targetId: 123 });
	});

	it("maps non-numeric id (e.g. /threads/new) to other", () => {
		expect(classifyPathKind("/threads/new")).toEqual({ kind: "other", targetId: 0 });
		expect(classifyPathKind("/forums/foo")).toEqual({ kind: "other", targetId: 0 });
		expect(classifyPathKind("/users/abc")).toEqual({ kind: "other", targetId: 0 });
	});

	it("classifies known bare container index pages as other", () => {
		// `/threads`, `/forums`, `/users` are the bare index pages of the
		// id-bearing prefixes — counted as `other` so we still see container
		// hits without a target id.
		expect(classifyPathKind("/threads")).toEqual({ kind: "other", targetId: 0 });
		expect(classifyPathKind("/forums")).toEqual({ kind: "other", targetId: 0 });
		expect(classifyPathKind("/users")).toEqual({ kind: "other", targetId: 0 });
	});

	it("fails closed (null) on unknown roots — D0 v2 fail-closed gate", () => {
		// Unknown roots MUST NOT silently land in `other`. Adding a new
		// public page requires an explicit allowlist entry.
		expect(classifyPathKind("/random")).toBeNull();
		expect(classifyPathKind("/admin/users")).toBeNull();
		expect(classifyPathKind("/about")).toBeNull();
		expect(classifyPathKind("/notifications")).toBeNull();
	});

	it("returns null for /api/auth/* callbacks (matcher allowlist edge)", () => {
		// Even though Next matcher allows /api/auth/*, the classifier
		// MUST drop it so ingest never records auth-callback navigations.
		expect(classifyPathKind("/api/auth/callback/google")).toBeNull();
		expect(classifyPathKind("/api/auth/session")).toBeNull();
	});
});

describe("buildIngestPayload", () => {
	it("serializes thread navigation with numeric target + user", () => {
		expect(buildIngestPayload("/threads/42", 7)).toEqual({
			path_kind: "thread",
			target_id: 42,
			user_id: 7,
		});
	});

	it("normalizes anonymous (userId<=0 / NaN) to 0", () => {
		expect(buildIngestPayload("/", 0)).toEqual({
			path_kind: "home",
			target_id: 0,
			user_id: 0,
		});
		expect(buildIngestPayload("/", -3)).toEqual({
			path_kind: "home",
			target_id: 0,
			user_id: 0,
		});
		expect(buildIngestPayload("/", Number.NaN)).toEqual({
			path_kind: "home",
			target_id: 0,
			user_id: 0,
		});
	});

	it("rounds non-integer userId down to int", () => {
		expect(buildIngestPayload("/", 1.9)).toEqual({
			path_kind: "home",
			target_id: 0,
			user_id: 1,
		});
	});

	it("returns null for paths that should not be ingested", () => {
		expect(buildIngestPayload("/api/foo", 0)).toBeNull();
		expect(buildIngestPayload("/_next/static/x", 0)).toBeNull();
	});
});

describe("tryRecordPageView", () => {
	const origEnv = { ...process.env };
	const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
	const origFetch = globalThis.fetch;

	beforeEach(() => {
		fetchSpy.mockClear();
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
	});
	afterEach(() => {
		globalThis.fetch = origFetch;
		process.env = { ...origEnv };
	});

	it("no-op when WORKER_API_URL is unset", async () => {
		process.env.WORKER_API_URL = "";
		process.env.ANALYTICS_INGEST_KEY = "secret";
		await tryRecordPageView({
			pathname: "/",
			userId: 0,
			clientIp: "1.2.3.4",
			userAgent: "Mozilla/5.0",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("no-op when ANALYTICS_INGEST_KEY is unset", async () => {
		process.env.WORKER_API_URL = "https://worker.test";
		process.env.ANALYTICS_INGEST_KEY = "";
		await tryRecordPageView({
			pathname: "/",
			userId: 0,
			clientIp: "1.2.3.4",
			userAgent: "Mozilla/5.0",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("no-op when path classifies to null (api / _next)", async () => {
		process.env.WORKER_API_URL = "https://worker.test";
		process.env.ANALYTICS_INGEST_KEY = "secret";
		await tryRecordPageView({
			pathname: "/api/something",
			userId: 0,
			clientIp: "1.2.3.4",
			userAgent: "Mozilla/5.0",
		});
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("POSTs to /api/internal/analytics/ingest with required headers + body", async () => {
		process.env.WORKER_API_URL = "https://worker.test/";
		process.env.ANALYTICS_INGEST_KEY = "secret-key";
		await tryRecordPageView({
			pathname: "/threads/42",
			userId: 7,
			clientIp: "9.9.9.9",
			userAgent: "Mozilla/5.0 (X11; Linux)",
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://worker.test/api/internal/analytics/ingest");
		expect(init.method).toBe("POST");
		const headers = init.headers as Record<string, string>;
		expect(headers["X-Ingest-Key"]).toBe("secret-key");
		expect(headers["X-Ellie-Client-IP"]).toBe("9.9.9.9");
		expect(headers["User-Agent"]).toBe("Mozilla/5.0 (X11; Linux)");
		expect(headers["Content-Type"]).toBe("application/json");
		expect(init.cache).toBe("no-store");
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({ path_kind: "thread", target_id: 42, user_id: 7 });
	});

	it("does not attach X-Real-IP when clientIp is empty (production fallback)", async () => {
		process.env.WORKER_API_URL = "https://worker.test";
		process.env.ANALYTICS_INGEST_KEY = "secret";
		await tryRecordPageView({
			pathname: "/",
			userId: 0,
			clientIp: "",
			userAgent: "ua",
		});
		const init = fetchSpy.mock.calls[0][1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers["X-Ellie-Client-IP"]).toBeUndefined();
		expect(headers["X-Ingest-Key"]).toBe("secret");
	});

	it("swallows fetch errors silently — never rejects", async () => {
		process.env.WORKER_API_URL = "https://worker.test";
		process.env.ANALYTICS_INGEST_KEY = "secret";
		fetchSpy.mockRejectedValueOnce(new Error("network down"));
		await expect(
			tryRecordPageView({
				pathname: "/",
				userId: 0,
				clientIp: "",
				userAgent: "ua",
			}),
		).resolves.toBeUndefined();
	});
});
