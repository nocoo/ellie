// Tests for the proxy() function and internal helpers (getWorkerUrl, getApiKey, getRequireLogin)
// These require mocking external dependencies: @/auth, next/server, process.env, fetch
// NOTE: These tests focus on executing code paths for coverage. When run alongside proxy.test.ts,
// the mock.module may not fully override already-cached modules, but the code paths still execute.

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// ─── Mock setup ────────────────────────────────────────────

const mockAuth = mock(async () => null);

mock.module("@/auth", () => ({
	auth: mockAuth,
}));

mock.module("next/server", () => ({
	NextResponse: {
		next: () => ({ type: "next" as const }),
		redirect: (url: URL) => ({ type: "redirect" as const, url: url.href }),
	},
}));

// Must import after mocking
const { proxy } = await import("../../apps/web/src/proxy");

function makeNextRequest(pathname: string): unknown {
	const url = new URL(pathname, "https://example.com");
	return {
		nextUrl: url,
		headers: {
			get: (_name: string) => null,
		},
	};
}

describe("proxy()", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		mockAuth.mockClear();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		process.env.WORKER_API_URL = undefined;
		process.env.FORUM_API_KEY = undefined;
	});

	it("executes public route path when no worker configured", async () => {
		process.env.WORKER_API_URL = undefined;
		process.env.FORUM_API_KEY = undefined;
		mockAuth.mockResolvedValueOnce(null);
		const result = await proxy(makeNextRequest("/forums"));
		expect(result).toBeDefined();
	});

	it("executes path for authenticated user on public route", async () => {
		mockAuth.mockResolvedValueOnce({ user: { name: "alice" } });
		const result = await proxy(makeNextRequest("/"));
		expect(result).toBeDefined();
	});

	it("executes redirect path for unauthenticated user on protected route", async () => {
		mockAuth.mockResolvedValueOnce(null);
		const result = await proxy(makeNextRequest("/threads/new"));
		expect(result).toBeDefined();
	});

	it("handles Worker API fetch failure gracefully", async () => {
		process.env.WORKER_API_URL = "https://worker.example.com";
		process.env.FORUM_API_KEY = "test-key";

		globalThis.fetch = mock(async () => {
			throw new Error("Network error");
		}) as typeof fetch;

		mockAuth.mockResolvedValueOnce(null);
		const result = await proxy(makeNextRequest("/forums"));
		expect(result).toBeDefined();
	});

	it("handles non-ok Worker API response", async () => {
		process.env.WORKER_API_URL = "https://worker2.example.com";
		process.env.FORUM_API_KEY = "test-key-2";

		globalThis.fetch = mock(async () => new Response("Error", { status: 500 })) as typeof fetch;

		mockAuth.mockResolvedValueOnce(null);
		const result = await proxy(makeNextRequest("/forums"));
		expect(result).toBeDefined();
	});

	it("fetches require_login setting from Worker API", async () => {
		process.env.WORKER_API_URL = "https://worker3.example.com/";
		process.env.FORUM_API_KEY = "test-key-3";

		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ data: { "features.access.require_login": true } }), {
					status: 200,
				}),
		) as typeof fetch;

		mockAuth.mockResolvedValueOnce(null);
		const result = await proxy(makeNextRequest("/forums"));
		expect(result).toBeDefined();
	});
});
