// analyticsIngest.test.ts — P5 internal ingest handler boundary tests.
//
// Pins the trust-edge contract reviewer-required for P5:
//
//   1. Secret check is the FIRST observable side-effect. Missing /
//      wrong `X-Ingest-Key` MUST return 401 without calling
//      `extractTrustedClientIp`, `parseBotClass`, `recordPageView`, or
//      `scheduleFlush`.
//   2. Body schema is a STRICT WHITELIST: unknown keys (incl.
//      `bot_class`, `ip`, `ua`, `label`) → 400 `INVALID_REQUEST`.
//      Reviewer-pinned: protocol drift surfaces as a hard error, not a
//      silent drop.
//   3. Server is authoritative for `bot_class` (UA-derived). Body
//      cannot override.
//   4. `recordPageView` + `scheduleFlush` are both called on the
//      success path. Pure ingest with no flush would let in-isolate
//      buckets balloon indefinitely.
//   5. `X-Real-IP` is trusted ONLY when the secret check has passed —
//      `trustXRealIp` opt-in into `extractTrustedClientIp` is the
//      only legal use.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	analyticsIngestHandler,
	constantTimeEqualStr,
	shanghaiDateLocal,
	validateIngestBody,
} from "../../../../src/handlers/internal/analyticsIngest";
import * as collect from "../../../../src/lib/analytics/collect";
import * as clientIp from "../../../../src/lib/clientIp";
import { createMockCtx, makeEnv } from "../../../helpers";

const INGEST_KEY = "test-ingest-key-deadbeef";

function makeRequest(
	opts: {
		method?: string;
		headers?: Record<string, string>;
		body?: unknown;
	} = {},
): Request {
	const headers = new Headers(opts.headers ?? {});
	const init: RequestInit = {
		method: opts.method ?? "POST",
		headers,
	};
	if (opts.body !== undefined) {
		if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
		init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
	}
	return new Request("https://worker.test/api/internal/analytics/ingest", init);
}

beforeEach(() => {
	// Each test starts with a clean spy + reset throttle / sink in the
	// collector so the in-isolate state from a previous case can't bleed
	// into the next assertion.
	collect.resetFlushSink();
	collect.resetFlushThrottle();
	// Drain leftover bucket state.
	collect.swapBuckets();
});

afterEach(() => {
	vi.restoreAllMocks();
	collect.resetFlushSink();
	collect.resetFlushThrottle();
	collect.swapBuckets();
});

describe("constantTimeEqualStr", () => {
	it("returns true for identical strings", () => {
		expect(constantTimeEqualStr("abc", "abc")).toBe(true);
	});
	it("returns false for differing strings of same length", () => {
		expect(constantTimeEqualStr("abc", "abd")).toBe(false);
	});
	it("returns false for differing lengths", () => {
		expect(constantTimeEqualStr("abc", "abcd")).toBe(false);
	});
	it("returns true for two empty strings", () => {
		expect(constantTimeEqualStr("", "")).toBe(true);
	});
});

describe("shanghaiDateLocal", () => {
	it("formats YYYY-MM-DD for a fixed Asia/Shanghai timestamp", () => {
		// 2026-05-20 12:00:00 Asia/Shanghai = 1768953600 - 8h = 1768924800
		// Pick something unambiguous within the day window.
		const nowSec = 1747740000; // 2025-05-20 around midday UTC
		expect(shanghaiDateLocal(nowSec)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
	it("crosses local midnight correctly", () => {
		// 23:59:00 Asia/Shanghai = 15:59:00 UTC
		// (any consistent date pair will do — we only pin shape + roundtrip).
		const before = shanghaiDateLocal(1747756800 - 60); // 23:58:00 +08
		const after = shanghaiDateLocal(1747756800 + 60); // 00:01:00 +08 next day
		expect(before).not.toEqual(after);
	});
});

describe("validateIngestBody", () => {
	it("accepts a minimal valid body", () => {
		const r = validateIngestBody({ path_kind: "thread", target_id: 42, user_id: 7 });
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ pathKind: "thread", targetId: 42, userId: 7 });
		}
	});

	it("accepts target_id=0 and user_id=0 (home / anonymous)", () => {
		const r = validateIngestBody({ path_kind: "home", target_id: 0, user_id: 0 });
		expect(r.ok).toBe(true);
	});

	it("rejects unknown key bot_class — strict whitelist", () => {
		const r = validateIngestBody({
			path_kind: "thread",
			target_id: 1,
			user_id: 0,
			bot_class: "human",
		});
		expect(r.ok).toBe(false);
	});

	it("rejects unknown key label", () => {
		const r = validateIngestBody({
			path_kind: "thread",
			target_id: 1,
			user_id: 0,
			label: "thread title",
		});
		expect(r.ok).toBe(false);
	});

	it("rejects unknown key ip", () => {
		const r = validateIngestBody({
			path_kind: "thread",
			target_id: 1,
			user_id: 0,
			ip: "1.2.3.4",
		});
		expect(r.ok).toBe(false);
	});

	it("rejects unknown key ua", () => {
		const r = validateIngestBody({
			path_kind: "thread",
			target_id: 1,
			user_id: 0,
			ua: "Mozilla/5.0",
		});
		expect(r.ok).toBe(false);
	});

	it("rejects non-enum path_kind", () => {
		const r = validateIngestBody({ path_kind: "static", target_id: 1, user_id: 0 });
		expect(r.ok).toBe(false);
	});

	it("rejects negative target_id", () => {
		const r = validateIngestBody({ path_kind: "thread", target_id: -1, user_id: 0 });
		expect(r.ok).toBe(false);
	});

	it("rejects non-integer target_id", () => {
		const r = validateIngestBody({ path_kind: "thread", target_id: 1.5, user_id: 0 });
		expect(r.ok).toBe(false);
	});

	it("rejects negative user_id", () => {
		const r = validateIngestBody({ path_kind: "thread", target_id: 1, user_id: -3 });
		expect(r.ok).toBe(false);
	});

	it("rejects non-object body", () => {
		expect(validateIngestBody(null).ok).toBe(false);
		expect(validateIngestBody(undefined).ok).toBe(false);
		expect(validateIngestBody("hello").ok).toBe(false);
		expect(validateIngestBody(42).ok).toBe(false);
		expect(validateIngestBody([1, 2, 3]).ok).toBe(false);
	});

	it("rejects missing path_kind", () => {
		expect(validateIngestBody({ target_id: 1, user_id: 0 }).ok).toBe(false);
	});
});

describe("analyticsIngestHandler — method + configuration gates", () => {
	it("returns 405 for GET", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const res = await analyticsIngestHandler(makeRequest({ method: "GET" }), env, ctx);
		expect(res.status).toBe(405);
	});

	it("returns 503 INGEST_NOT_CONFIGURED when ANALYTICS_INGEST_KEY unset", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: undefined });
		const ctx = createMockCtx();
		const recordSpy = vi.spyOn(collect, "recordPageView");
		const ipSpy = vi.spyOn(clientIp, "extractTrustedClientIp");
		const res = await analyticsIngestHandler(
			makeRequest({
				headers: { "X-Ingest-Key": INGEST_KEY },
				body: { path_kind: "home", target_id: 0, user_id: 0 },
			}),
			env,
			ctx,
		);
		expect(res.status).toBe(503);
		expect(recordSpy).not.toHaveBeenCalled();
		expect(ipSpy).not.toHaveBeenCalled();
	});
});

describe("analyticsIngestHandler — 401 trust boundary", () => {
	it("missing X-Ingest-Key → 401 + no collector / no IP read", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const recordSpy = vi.spyOn(collect, "recordPageView");
		const flushSpy = vi.spyOn(collect, "scheduleFlush");
		const ipSpy = vi.spyOn(clientIp, "extractTrustedClientIp");

		const res = await analyticsIngestHandler(
			makeRequest({
				headers: { "X-Real-IP": "5.5.5.5", "User-Agent": "Mozilla/5.0" },
				body: { path_kind: "home", target_id: 0, user_id: 0 },
			}),
			env,
			ctx,
		);

		expect(res.status).toBe(401);
		expect(recordSpy).not.toHaveBeenCalled();
		expect(flushSpy).not.toHaveBeenCalled();
		expect(ipSpy).not.toHaveBeenCalled();
	});

	it("wrong X-Ingest-Key (differ by 1 char) → 401 + no collector / no IP read", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const recordSpy = vi.spyOn(collect, "recordPageView");
		const flushSpy = vi.spyOn(collect, "scheduleFlush");
		const ipSpy = vi.spyOn(clientIp, "extractTrustedClientIp");

		const wrongKey = `${INGEST_KEY.slice(0, -1)}X`;
		const res = await analyticsIngestHandler(
			makeRequest({
				headers: {
					"X-Ingest-Key": wrongKey,
					"X-Real-IP": "5.5.5.5",
					"User-Agent": "Mozilla/5.0",
				},
				body: { path_kind: "home", target_id: 0, user_id: 0 },
			}),
			env,
			ctx,
		);

		expect(res.status).toBe(401);
		expect(recordSpy).not.toHaveBeenCalled();
		expect(flushSpy).not.toHaveBeenCalled();
		expect(ipSpy).not.toHaveBeenCalled();
	});
});

describe("analyticsIngestHandler — 400 body validation", () => {
	it("returns 400 INVALID_REQUEST on malformed JSON", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const req = new Request("https://worker.test/api/internal/analytics/ingest", {
			method: "POST",
			headers: { "X-Ingest-Key": INGEST_KEY, "Content-Type": "application/json" },
			body: "{not json",
		});
		const res = await analyticsIngestHandler(req, env, ctx);
		expect(res.status).toBe(400);
	});

	it("returns 400 on unknown body key bot_class (strict whitelist)", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const recordSpy = vi.spyOn(collect, "recordPageView");
		const res = await analyticsIngestHandler(
			makeRequest({
				headers: { "X-Ingest-Key": INGEST_KEY },
				body: { path_kind: "thread", target_id: 1, user_id: 0, bot_class: "human" },
			}),
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		expect(recordSpy).not.toHaveBeenCalled();
	});

	it("returns 400 on non-enum path_kind", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const res = await analyticsIngestHandler(
			makeRequest({
				headers: { "X-Ingest-Key": INGEST_KEY },
				body: { path_kind: "static", target_id: 0, user_id: 0 },
			}),
			env,
			ctx,
		);
		expect(res.status).toBe(400);
	});
});

describe("analyticsIngestHandler — success path", () => {
	it("200 + records sample + schedules flush + IP/UA come from headers", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const recordSpy = vi.spyOn(collect, "recordPageView");
		const flushSpy = vi.spyOn(collect, "scheduleFlush");

		const res = await analyticsIngestHandler(
			makeRequest({
				headers: {
					"X-Ingest-Key": INGEST_KEY,
					"X-Real-IP": "7.7.7.7",
					"User-Agent": "Mozilla/5.0 (X11; Linux)",
				},
				body: { path_kind: "thread", target_id: 42, user_id: 7 },
			}),
			env,
			ctx,
		);

		expect(res.status).toBe(200);
		expect(recordSpy).toHaveBeenCalledTimes(1);
		expect(flushSpy).toHaveBeenCalledTimes(1);
		const sample = recordSpy.mock.calls[0][0];
		expect(sample.pathKind).toBe("thread");
		expect(sample.targetId).toBe(42);
		expect(sample.userId).toBe(7);
		expect(sample.botClass).toBe("human");
	});

	it("server is authoritative for bot_class — body label is rejected, UA wins", async () => {
		// Body cannot carry `bot_class` at all (strict whitelist); reviewer
		// pin: if a client tries to override with bot_class:'human' but UA
		// is Googlebot, the body is rejected (400) AND if no extra key
		// is sent, the server-side parseBotClass classifies as bot_search.
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const ctx = createMockCtx();
		const recordSpy = vi.spyOn(collect, "recordPageView");

		const res = await analyticsIngestHandler(
			makeRequest({
				headers: {
					"X-Ingest-Key": INGEST_KEY,
					"User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
				},
				body: { path_kind: "home", target_id: 0, user_id: 0 },
			}),
			env,
			ctx,
		);

		expect(res.status).toBe(200);
		expect(recordSpy).toHaveBeenCalledTimes(1);
		expect(recordSpy.mock.calls[0][0].botClass).toBe("bot_search");
	});

	it("does not throw when ctx is undefined (test stubs)", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY });
		const recordSpy = vi.spyOn(collect, "recordPageView");
		const flushSpy = vi.spyOn(collect, "scheduleFlush");
		const res = await analyticsIngestHandler(
			makeRequest({
				headers: { "X-Ingest-Key": INGEST_KEY, "User-Agent": "Mozilla/5.0" },
				body: { path_kind: "home", target_id: 0, user_id: 0 },
			}),
			env,
		);
		expect(res.status).toBe(200);
		expect(recordSpy).toHaveBeenCalledTimes(1);
		expect(flushSpy).not.toHaveBeenCalled();
	});

	it("X-Real-IP is trusted via the trustXRealIp opt-in (post-secret)", async () => {
		const env = makeEnv({ ANALYTICS_INGEST_KEY: INGEST_KEY, ENVIRONMENT: "production" });
		const ctx = createMockCtx();
		const ipSpy = vi.spyOn(clientIp, "extractTrustedClientIp");

		const res = await analyticsIngestHandler(
			makeRequest({
				headers: {
					"X-Ingest-Key": INGEST_KEY,
					"X-Real-IP": "9.9.9.9",
					"User-Agent": "Mozilla/5.0",
				},
				body: { path_kind: "home", target_id: 0, user_id: 0 },
			}),
			env,
			ctx,
		);
		expect(res.status).toBe(200);
		expect(ipSpy).toHaveBeenCalledTimes(1);
		const passedOpts = ipSpy.mock.calls[0][2];
		expect(passedOpts).toEqual({ trustXRealIp: true });
		expect(ipSpy.mock.results[0].value).toBe("9.9.9.9");
	});
});
