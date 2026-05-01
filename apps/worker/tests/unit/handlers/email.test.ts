// Unit tests for email-verification HTTP handlers (docs/17 §7.2, §7.3).
// Mocks the dove client module (NOT global fetch) so this file is safe to run
// concurrently with apps/worker/tests/unit/lib/dove.test.ts which DOES stub
// globalThis.fetch.

import { beforeEach, describe, expect, it, mock } from "bun:test";

// Module-level dove stub. Behavior is encoded in `env.DOVE_PROJECT_ID` so each
// test (which owns its own env) gets isolated behavior under --concurrent.
const doveCallsByEnv = new WeakMap<object, number>();
mock.module("../../../src/lib/dove", () => ({
	sendDoveEmail: async (env: { DOVE_PROJECT_ID?: string }) => {
		doveCallsByEnv.set(env, (doveCallsByEnv.get(env) ?? 0) + 1);
		if (env.DOVE_PROJECT_ID === "fail") {
			return { ok: false, code: "recipient_not_found", status: 404 };
		}
		return { ok: true };
	},
}));

import { requestCode, verifyCode } from "../../../src/handlers/email";
import {
	CODE_TTL_SECONDS,
	type CodeRecord,
	codeKvKey,
	computeCodeHmac,
} from "../../../src/lib/email-verify";
import type { Env } from "../../../src/lib/env";
import { createJwt } from "../../../src/lib/jwt";
import { createMockDb, createMockKV } from "../../helpers";

const HMAC_KEY = "test-hmac-key-do-not-use-in-prod";
const JWT_SECRET = "test-jwt-secret-for-hs256";

function makeEnv(opts: {
	dbUser: {
		role: number;
		status: number;
		email_verified_at: number;
		email?: string;
		email_normalized?: string;
		username?: string;
	} | null;
	kv?: Record<string, string>;
	doveConfigured?: boolean;
}): { env: Env; kv: KVNamespace } {
	const fullDbUser =
		opts.dbUser !== null
			? {
					role: opts.dbUser.role,
					status: opts.dbUser.status,
					email_verified_at: opts.dbUser.email_verified_at,
					email: opts.dbUser.email ?? "user@example.com",
					email_normalized: opts.dbUser.email_normalized ?? "user@example.com",
					username: opts.dbUser.username ?? "alice",
				}
			: null;

	const { db } = createMockDb({
		firstResults: {
			// authMiddlewareVerified hits SELECT role, status FROM users
			"SELECT role, status FROM users":
				fullDbUser === null ? null : { role: fullDbUser.role, status: fullDbUser.status },
			// loadUser inside the handler hits SELECT email, email_normalized,...
			"SELECT email, email_normalized, email_verified_at, username FROM users":
				fullDbUser === null ? null : fullDbUser,
		},
	});

	const kv = createMockKV(opts.kv ?? {});
	const doveOn = opts.doveConfigured !== false;
	const env: Env = {
		API_KEY: "k",
		ADMIN_API_KEY: "k",
		DB: db,
		ENVIRONMENT: "test",
		JWT_SECRET,
		KV: kv,
		R2: {} as R2Bucket,
		EMAIL_VERIFY_HMAC_KEY: HMAC_KEY,
		DOVE_BASE_URL: doveOn ? "https://dove.example.com" : undefined,
		DOVE_PROJECT_ID: doveOn ? "ellie" : undefined,
		DOVE_WEBHOOK_TOKEN: doveOn ? "tok" : undefined,
	};
	return { env, kv };
}

async function makeRequest(path: string, body?: unknown, userId = 7): Promise<Request> {
	const token = await createJwt(
		{ userId, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
		JWT_SECRET,
	);
	return new Request(`https://example.com${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
	// Defensive: if any unmocked code path tries to fetch, fail loudly.
	globalThis.fetch = (() => {
		throw new Error("fetch should be mocked via dove module — handlers must not hit real network");
	}) as unknown as typeof fetch;
});

function stubDoveOk(env: Env): { calls: number } {
	// project-id "ellie" → ok path
	env.DOVE_PROJECT_ID = "ellie";
	return {
		get calls() {
			return doveCallsByEnv.get(env) ?? 0;
		},
	};
}

function stubDoveFail(env: Env): { calls: number } {
	env.DOVE_PROJECT_ID = "fail";
	return {
		get calls() {
			return doveCallsByEnv.get(env) ?? 0;
		},
	};
}

import { afterAll } from "bun:test";
afterAll(() => {
	globalThis.fetch = originalFetch;
});

// ───────────────────────────── request-code ─────────────────────────────

describe("requestCode (POST /api/v1/users/me/email/request-code)", () => {
	it("returns 401 when no JWT", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const req = new Request("https://example.com/x", { method: "POST" });
		const res = await requestCode(req, env);
		expect(res.status).toBe(401);
	});

	it("returns 403 EMAIL_ALREADY_VERIFIED when user already verified", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 1700000000 },
		});
		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_VERIFIED");
	});

	it("returns 400 EMAIL_INVALID when normalized email is empty/garbage", async () => {
		const { env } = makeEnv({
			dbUser: {
				role: 0,
				status: 0,
				email_verified_at: 0,
				email: "",
				email_normalized: "",
			},
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("EMAIL_INVALID");
	});

	it("on success, persists KV record with HMAC + TTL and returns masked recipient", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.sent_to).toBe("u***@example.com");
		expect(body.data.expires_in).toBe(CODE_TTL_SECONDS);

		const raw = await kv.get(codeKvKey(7));
		expect(raw).not.toBeNull();
		const rec = JSON.parse(raw as string) as CodeRecord;
		expect(rec.codeHmac).toMatch(/^[0-9a-f]{64}$/);
		expect(rec.targetEmailNormalized).toBe("user@example.com");
		expect(rec.attempts).toBe(0);
		expect(rec.lastSentAt).toBeGreaterThan(0);
		expect(rec.expiresAt - rec.lastSentAt).toBe(CODE_TTL_SECONDS);
	});

	it("returns 502 EMAIL_PROVIDER_FAILED and DOES NOT mutate KV when dove fails", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		stubDoveFail(env);
		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe("EMAIL_PROVIDER_FAILED");
		// Critical: KV must remain empty so the user can retry without burning the throttle.
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 429 CODE_RESEND_THROTTLED when called within 60s of last send", async () => {
		const now = Math.floor(Date.now() / 1000);
		const existing: CodeRecord = {
			codeHmac: "f".repeat(64),
			targetEmailNormalized: "user@example.com",
			expiresAt: now + 600,
			attempts: 0,
			lastSentAt: now - 5, // 5s ago — well within throttle window
		};
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [codeKvKey(7)]: JSON.stringify(existing) },
		});
		const fetchTracker = stubDoveOk(env);

		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error.code).toBe("CODE_RESEND_THROTTLED");
		expect(body.error.details.next_resend_allowed_at).toBe(existing.lastSentAt + 60);
		// Dove must NOT be called when throttle blocks the request.
		expect(fetchTracker.calls).toBe(0);
		// KV record left unchanged.
		const raw = await kv.get(codeKvKey(7));
		expect(JSON.parse(raw as string).lastSentAt).toBe(existing.lastSentAt);
	});

	it("allows resend after the throttle window has elapsed", async () => {
		const now = Math.floor(Date.now() / 1000);
		const existing: CodeRecord = {
			codeHmac: "f".repeat(64),
			targetEmailNormalized: "user@example.com",
			expiresAt: now + 600,
			attempts: 0,
			lastSentAt: now - 120, // 2 minutes ago
		};
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [codeKvKey(7)]: JSON.stringify(existing) },
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(200);
		const newRec = JSON.parse((await kv.get(codeKvKey(7))) as string) as CodeRecord;
		expect(newRec.lastSentAt).toBeGreaterThan(existing.lastSentAt);
		// New code → new HMAC (with overwhelming probability).
		expect(newRec.codeHmac).not.toBe(existing.codeHmac);
	});

	it("returns 500 INTERNAL_ERROR when EMAIL_VERIFY_HMAC_KEY is missing", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		(env as { EMAIL_VERIFY_HMAC_KEY?: string }).EMAIL_VERIFY_HMAC_KEY = undefined;
		const res = await requestCode(await makeRequest("/x"), env);
		expect(res.status).toBe(500);
	});
});

// ───────────────────────────── verify ─────────────────────────────

describe("verifyCode (POST /api/v1/users/me/email/verify)", () => {
	async function seedRecord(args: {
		userId?: number;
		code: string;
		emailNormalized?: string;
		ageSeconds?: number;
		attempts?: number;
		ttlSeconds?: number;
	}): Promise<{ record: CodeRecord; kvSeed: Record<string, string> }> {
		const userId = args.userId ?? 7;
		const emailNormalized = args.emailNormalized ?? "user@example.com";
		const codeHmac = await computeCodeHmac(HMAC_KEY, userId, emailNormalized, args.code);
		const now = Math.floor(Date.now() / 1000);
		const record: CodeRecord = {
			codeHmac,
			targetEmailNormalized: emailNormalized,
			expiresAt: now + (args.ttlSeconds ?? 600),
			attempts: args.attempts ?? 0,
			lastSentAt: now - (args.ageSeconds ?? 30),
		};
		return { record, kvSeed: { [codeKvKey(userId)]: JSON.stringify(record) } };
	}

	it("returns 400 CODE_FORMAT_INVALID for non-6-digit input", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(await makeRequest("/x", { code: "12345" }), env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("CODE_FORMAT_INVALID");
	});

	it("returns 400 CODE_FORMAT_INVALID for non-digit input", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(await makeRequest("/x", { code: "abcdef" }), env);
		expect(res.status).toBe(400);
	});

	it("returns 404 CODE_NOT_FOUND when no KV record exists", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(await makeRequest("/x", { code: "123456" }), env);
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe("CODE_NOT_FOUND");
	});

	it("on success, sets email_verified_at and deletes KV record", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(await makeRequest("/x", { code: "123456" }), env);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.verified).toBe(true);
		expect(body.data.verified_at).toBeGreaterThan(0);
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 403 CODE_INVALID and increments attempts on wrong code", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(await makeRequest("/x", { code: "999999" }), env);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe("CODE_INVALID");
		expect(body.error.details.attempts_remaining).toBe(4);
		const rec = JSON.parse((await kv.get(codeKvKey(7))) as string) as CodeRecord;
		expect(rec.attempts).toBe(1);
	});

	it("returns 403 CODE_LOCKED on the 5th wrong attempt and deletes KV record", async () => {
		const { kvSeed } = await seedRecord({ code: "123456", attempts: 4 });
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(await makeRequest("/x", { code: "999999" }), env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("CODE_LOCKED");
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 404 CODE_NOT_FOUND when stored record has already expired (defensive)", async () => {
		// expiresAt in the past — KV TTL would normally evict, but if the
		// record persists for any reason we must treat it as gone.
		const { record } = await seedRecord({ code: "123456" });
		const expired: CodeRecord = { ...record, expiresAt: 1 };
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [codeKvKey(7)]: JSON.stringify(expired) },
		});
		const res = await verifyCode(await makeRequest("/x", { code: "123456" }), env);
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe("CODE_NOT_FOUND");
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 409 EMAIL_CHANGED_SINCE_CODE when email differs from the record", async () => {
		const { kvSeed } = await seedRecord({
			code: "123456",
			emailNormalized: "old@example.com",
		});
		const { env, kv } = makeEnv({
			dbUser: {
				role: 0,
				status: 0,
				email_verified_at: 0,
				email: "new@example.com",
				email_normalized: "new@example.com",
			},
			kv: kvSeed,
		});
		const res = await verifyCode(await makeRequest("/x", { code: "123456" }), env);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_CHANGED_SINCE_CODE");
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 403 EMAIL_ALREADY_VERIFIED when user verified out-of-band", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 1700000000 },
			kv: kvSeed,
		});
		const res = await verifyCode(await makeRequest("/x", { code: "123456" }), env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_VERIFIED");
	});

	it("returns 401 when token is missing", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const req = new Request("https://example.com/x", {
			method: "POST",
			body: JSON.stringify({ code: "123456" }),
		});
		const res = await verifyCode(req, env);
		expect(res.status).toBe(401);
	});

	it("returns 400 INVALID_BODY when body is not JSON", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const token = await createJwt(
			{ userId: 7, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			JWT_SECRET,
		);
		const req = new Request("https://example.com/x", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: "not json",
		});
		const res = await verifyCode(req, env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("INVALID_BODY");
	});
});
