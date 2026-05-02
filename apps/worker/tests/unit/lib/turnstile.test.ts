// Unit tests for the Cloudflare Turnstile client (docs/17 §7.2.1 — rev4).
// Stubs global fetch — never makes a real network call. Runs under bun:test
// because the worker vitest config uses pool=threads + isolate=false, which
// makes globalThis.fetch stubs unsafe across concurrent test files (the same
// reason dove.test.ts also lives in the bun:test lane).

import { afterEach, describe, expect, it } from "bun:test";
import type { Env } from "../../../src/lib/env";
import { verifyTurnstileToken } from "../../../src/lib/turnstile";
import { createMockKV } from "../../helpers";

function baseEnv(overrides: Partial<Env> = {}): Env {
	return {
		API_KEY: "k",
		ADMIN_API_KEY: "k",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "s",
		KV: createMockKV(),
		R2: {} as R2Bucket,
		// Documented Cloudflare always-pass test secret.
		TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
		TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
		...overrides,
	};
}

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

describe("verifyTurnstileToken — config and request shape", () => {
	it("returns success=false with reason 'missing-secret' when TURNSTILE_SECRET_KEY is unset", async () => {
		const env = baseEnv({ TURNSTILE_SECRET_KEY: undefined });
		globalThis.fetch = (() => {
			throw new Error("fetch must NOT be called when secret is missing");
		}) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("missing-secret");
	});

	it("posts form-encoded secret + response (+ remoteip when given) to Cloudflare siteverify", async () => {
		const env = baseEnv();
		const calls: { url: string; init?: RequestInit }[] = [];
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return new Response(JSON.stringify({ success: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}) as unknown as typeof fetch;

		const res = await verifyTurnstileToken(env, "the-token", "203.0.113.7");
		expect(res.success).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(SITEVERIFY_URL);
		expect(calls[0].init?.method).toBe("POST");
		const headers = new Headers(calls[0].init?.headers);
		expect(headers.get("Content-Type")).toBe("application/x-www-form-urlencoded");
		const params = new URLSearchParams(String(calls[0].init?.body ?? ""));
		expect(params.get("secret")).toBe("1x0000000000000000000000000000000AA");
		expect(params.get("response")).toBe("the-token");
		expect(params.get("remoteip")).toBe("203.0.113.7");
	});

	it("omits remoteip from the body when caller does not provide one", async () => {
		const env = baseEnv();
		let body = "";
		globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
			body = String(init?.body ?? "");
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		}) as unknown as typeof fetch;

		await verifyTurnstileToken(env, "tok");
		const params = new URLSearchParams(body);
		expect(params.has("remoteip")).toBe(false);
		expect(params.get("response")).toBe("tok");
	});
});

describe("verifyTurnstileToken — response handling", () => {
	it("returns success=true on { success: true }", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ success: true }), { status: 200 })) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res).toEqual({ success: true });
	});

	it("returns success=false with first error-code as reason on { success: false }", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({ success: false, "error-codes": ["invalid-input-response", "x"] }),
				{ status: 200 },
			)) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("invalid-input-response");
	});

	it("returns success=false with reason 'rejected' when error-codes is missing", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ success: false }), { status: 200 })) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("rejected");
	});

	it("returns success=false with reason 'invalid_json' when body is not JSON", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () =>
			new Response("not-json", { status: 200 })) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("invalid_json");
	});

	it("returns success=false with reason 'http_<code>' when Cloudflare returns 5xx (fail-closed)", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () =>
			new Response("upstream", { status: 502 })) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("http_502");
	});
});

describe("verifyTurnstileToken — fail-closed on transport errors", () => {
	it("returns success=false with reason 'network_error' on generic fetch rejection", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () => {
			throw new Error("DNS borked");
		}) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("network_error");
	});

	it("returns success=false with reason 'timeout' on AbortSignal.timeout firing", async () => {
		const env = baseEnv();
		globalThis.fetch = (async () => {
			// Mimic the DOMException AbortSignal.timeout produces.
			const err = new Error("The operation was aborted");
			err.name = "TimeoutError";
			throw err;
		}) as unknown as typeof fetch;
		const res = await verifyTurnstileToken(env, "tok");
		expect(res.success).toBe(false);
		expect(res.reason).toBe("timeout");
	});
});
