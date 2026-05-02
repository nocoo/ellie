// Unit tests for the dove client (docs/17 §8).
// Stubs global fetch — never makes a real network call.

import { afterEach, describe, expect, it, mock } from "bun:test";
import { sendDoveEmail } from "../../../src/lib/dove";
import type { Env } from "../../../src/lib/env";
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
		DOVE_BASE_URL: "https://dove.example.com",
		DOVE_PROJECT_ID: "ellie",
		DOVE_WEBHOOK_TOKEN: "tok",
		...overrides,
	};
}

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("sendDoveEmail — config validation", () => {
	it("returns dove_not_configured when DOVE_BASE_URL is missing", async () => {
		const env = baseEnv({ DOVE_BASE_URL: undefined });
		const res = await sendDoveEmail(env, {
			to: "x@y.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res).toEqual({ ok: false, code: "dove_not_configured", status: 0 });
	});

	it("returns dove_not_configured when DOVE_PROJECT_ID is missing", async () => {
		const env = baseEnv({ DOVE_PROJECT_ID: undefined });
		const res = await sendDoveEmail(env, {
			to: "x@y.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.code).toBe("dove_not_configured");
	});

	it("returns dove_not_configured when DOVE_WEBHOOK_TOKEN is missing", async () => {
		const env = baseEnv({ DOVE_WEBHOOK_TOKEN: undefined });
		const res = await sendDoveEmail(env, {
			to: "x@y.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res.ok).toBe(false);
	});
});

describe("sendDoveEmail — request shape and result mapping", () => {
	it("posts the canonical payload with bearer auth", async () => {
		let captured: { url: string; init: RequestInit } | null = null;
		globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
			captured = { url, init: init ?? {} };
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		}) as unknown as typeof fetch;

		const env = baseEnv();
		const res = await sendDoveEmail(env, {
			to: "u@example.com",
			template: "verify-email",
			idempotencyKey: "1:abcd",
			variables: { code: "123456" },
		});

		expect(res).toEqual({ ok: true });
		expect(captured).not.toBeNull();
		const c = captured as unknown as { url: string; init: RequestInit };
		expect(c.url).toBe("https://dove.example.com/api/webhook/ellie/send");
		const headers = c.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer tok");
		expect(headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(c.init.body as string)).toEqual({
			template: "verify-email",
			to: "u@example.com",
			idempotency_key: "1:abcd",
			variables: { code: "123456" },
		});
	});

	it("strips trailing slash on DOVE_BASE_URL", async () => {
		let url = "";
		globalThis.fetch = mock(async (u: string) => {
			url = u;
			return new Response("{}", { status: 200 });
		}) as unknown as typeof fetch;

		const env = baseEnv({ DOVE_BASE_URL: "https://dove.example.com//" });
		await sendDoveEmail(env, {
			to: "u@example.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(url).toBe("https://dove.example.com/api/webhook/ellie/send");
	});

	it("surfaces upstream error.code on 4xx with structured body", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: { code: "recipient_not_found" } }), {
					status: 404,
				}),
		) as unknown as typeof fetch;

		const env = baseEnv();
		const res = await sendDoveEmail(env, {
			to: "u@example.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res).toEqual({ ok: false, code: "recipient_not_found", status: 404 });
	});

	it("falls back to http_<status> when body is not JSON", async () => {
		globalThis.fetch = mock(
			async () => new Response("oops", { status: 502 }),
		) as unknown as typeof fetch;

		const env = baseEnv();
		const res = await sendDoveEmail(env, {
			to: "u@example.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res).toEqual({ ok: false, code: "http_502", status: 502 });
	});

	it("returns transport_error when fetch throws", async () => {
		globalThis.fetch = mock(async () => {
			throw new Error("boom");
		}) as unknown as typeof fetch;

		const env = baseEnv();
		const res = await sendDoveEmail(env, {
			to: "u@example.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.code).toBe("transport_error");
			expect(res.status).toBe(0);
		}
	});

	it("returns timeout when fetch throws TimeoutError", async () => {
		globalThis.fetch = mock(async () => {
			const e = new Error("aborted");
			e.name = "TimeoutError";
			throw e;
		}) as unknown as typeof fetch;

		const env = baseEnv();
		const res = await sendDoveEmail(env, {
			to: "u@example.com",
			template: "t",
			idempotencyKey: "k",
			variables: {},
		});
		expect(res.ok).toBe(false);
		if (!res.ok) expect(res.code).toBe("timeout");
	});
});
