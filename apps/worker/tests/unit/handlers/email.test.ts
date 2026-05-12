// Unit tests for email-verification HTTP handlers (docs/17 §7.2, §7.3).
// Mocks the dove client module (NOT global fetch) so this file is safe to run
// concurrently with apps/worker/tests/unit/lib/dove.test.ts which DOES stub
// globalThis.fetch.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Module-level dove stub. Behavior is encoded in `env.DOVE_PROJECT_ID` so each
// test (which owns its own env) gets isolated behavior under --concurrent.
// We also record the LAST input the handler passed to `sendDoveEmail`, keyed by
// env, so handler-contract tests can assert on `to` / `template` / `variables`
// without coupling to dove client internals.
interface RecordedDoveInput {
	to: string;
	template: string;
	idempotencyKey: string;
	variables: Record<string, string>;
}
// vi.mock is hoisted above imports, so the factory cannot close over module-
// level identifiers. Use vi.hoisted() to share the WeakMaps with the rest of
// this file.
const { doveCallsByEnv, lastDoveInputByEnv } = vi.hoisted(() => ({
	doveCallsByEnv: new WeakMap<object, number>(),
	lastDoveInputByEnv: new WeakMap<object, RecordedDoveInput>(),
}));
vi.mock("../../../src/lib/dove", () => ({
	sendDoveEmail: async (env: { DOVE_PROJECT_ID?: string }, input: RecordedDoveInput) => {
		doveCallsByEnv.set(env, (doveCallsByEnv.get(env) ?? 0) + 1);
		lastDoveInputByEnv.set(env, input);
		if (env.DOVE_PROJECT_ID === "fail") {
			return { ok: false, code: "recipient_not_found", status: 404 };
		}
		return { ok: true };
	},
}));

import { correctPendingEmail, requestCode, verifyCode } from "../../../src/handlers/email";
import {
	CODE_TTL_SECONDS,
	type CodeRecord,
	codeKvKey,
	computeCodeHmac,
	sendLockKvKey,
} from "../../../src/lib/email-verify";
import type { Env } from "../../../src/lib/env";
import { createJwt } from "../../../src/lib/jwt";
import { createMockDb, createMockKV } from "../../helpers";

const HMAC_KEY = "test-hmac-key-do-not-use-in-prod";
const JWT_SECRET = "test-jwt-secret-for-hs256";

// rev3: pending email lives in KV; users.email is irrelevant for these handlers.
// loadUser only reads (email_verified_at, username) and verifyCode runs an
// UPDATE. The mock DB returns meta.changes=1 by default; for unique-violation
// or zero-changes cases we wrap the DB.

interface DbUserState {
	role: number;
	status: number;
	email_verified_at: number;
	username?: string;
}

function makeEnv(opts: {
	dbUser: DbUserState | null;
	kv?: Record<string, string>;
	doveConfigured?: boolean;
	/** If set, the next UPDATE on users will throw this error (simulating D1 unique violation). */
	updateThrows?: Error;
	/** If set, the next UPDATE on users reports this many changed rows. */
	updateChanges?: number;
	/** If set, the email_normalized uniqueness pre-check returns this row (simulating another user owns the email). */
	emailOwner?: { id: number } | null;
}): { env: Env; kv: KVNamespace } {
	const dbUser = opts.dbUser;
	const userRow =
		dbUser === null
			? null
			: {
					role: dbUser.role,
					status: dbUser.status,
					email_verified_at: dbUser.email_verified_at,
					username: dbUser.username ?? "alice",
				};

	const { db: baseDb } = createMockDb({
		firstResults: {
			// authMiddlewareVerified hits SELECT role, status FROM users
			"SELECT role, status FROM users":
				userRow === null ? null : { role: userRow.role, status: userRow.status },
			// loadUser inside the handler hits SELECT email_verified_at, username FROM users
			"SELECT email_verified_at, username FROM users":
				userRow === null
					? null
					: { email_verified_at: userRow.email_verified_at, username: userRow.username },
			// requestCode email uniqueness pre-check
			"SELECT id FROM users WHERE email_normalized": opts.emailOwner ?? null,
		},
	});

	// Wrap prepare() to intercept UPDATE on the users table when needed.
	const origPrepare = baseDb.prepare;
	const db = {
		...baseDb,
		prepare: (sql: string) => {
			const stmt = origPrepare(sql);
			if (sql.startsWith("UPDATE users SET email")) {
				const origBind = stmt.bind;
				stmt.bind = (...params: unknown[]) => {
					const bound = origBind(...params);
					bound.run = async () => {
						if (opts.updateThrows) throw opts.updateThrows;
						return {
							success: true,
							meta: { last_row_id: 1, changes: opts.updateChanges ?? 1 },
						};
					};
					return bound;
				};
			}
			return stmt;
		},
	} as unknown as D1Database;

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

function stubDoveOk(env: Env): { calls: number; lastInput: RecordedDoveInput | undefined } {
	env.DOVE_PROJECT_ID = "ellie";
	return {
		get calls() {
			return doveCallsByEnv.get(env) ?? 0;
		},
		get lastInput() {
			return lastDoveInputByEnv.get(env);
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

afterAll(() => {
	globalThis.fetch = originalFetch;
});

// ───────────────────────────── request-code ─────────────────────────────

describe("requestCode (POST /api/v1/users/me/email/request-code)", () => {
	it("returns 401 when no JWT", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const req = new Request("https://example.com/x", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "user@example.com" }),
		});
		const res = await requestCode(req, env);
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
		const res = await requestCode(req, env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("INVALID_BODY");
	});

	it("returns 400 EMAIL_INVALID when body.email is missing", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await requestCode(await makeRequest("/x", {}), env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("EMAIL_INVALID");
	});

	it("returns 400 EMAIL_INVALID for malformed email", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await requestCode(await makeRequest("/x", { email: "not-an-email" }), env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("EMAIL_INVALID");
	});

	it("returns 403 EMAIL_ALREADY_VERIFIED when user already verified", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 1700000000 },
		});
		const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_VERIFIED");
	});

	it("returns 409 EMAIL_ALREADY_IN_USE when another user owns the normalized email", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			emailOwner: { id: 999 },
		});
		const res = await requestCode(await makeRequest("/x", { email: "taken@example.com" }), env);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_IN_USE");
	});

	it("returns 409 EMAIL_ALREADY_IN_USE with case-insensitive match", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			emailOwner: { id: 999 },
		});
		const res = await requestCode(await makeRequest("/x", { email: "Taken@EXAMPLE.com" }), env);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_IN_USE");
	});

	it("allows requestCode when no other user owns the email", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			emailOwner: null,
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x", { email: "fresh@example.com" }), env);
		expect(res.status).toBe(200);
	});

	it("on success, persists KV record with HMAC + TTL and returns masked recipient", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x", { email: "User@Example.COM" }), env);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.sent_to).toBe("u***@example.com");
		expect(body.data.expires_in).toBe(CODE_TTL_SECONDS);

		const raw = await kv.get(codeKvKey(7));
		expect(raw).not.toBeNull();
		const rec = JSON.parse(raw as string) as CodeRecord;
		expect(rec.codeHmac).toMatch(/^[0-9a-f]{64}$/);
		// Display form preserves the user-typed casing (after trim).
		expect(rec.pendingEmail).toBe("User@Example.COM");
		// Normalized form is lowercased, used for HMAC + match check.
		expect(rec.pendingEmailNormalized).toBe("user@example.com");
		expect(rec.attempts).toBe(0);
		expect(rec.lastSentAt).toBeGreaterThan(0);
		expect(rec.expiresAt - rec.lastSentAt).toBe(CODE_TTL_SECONDS);
		// In-flight lock must be released after a successful send.
		expect(await kv.get(sendLockKvKey(7))).toBeNull();
	});

	it("(§8) sends to the user-provided pendingEmail with template slug `verify-email` and ONLY the `code` variable", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		const dove = stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x", { email: "User@Example.COM" }), env);
		expect(res.status).toBe(200);

		const last = dove.lastInput;
		expect(last).toBeDefined();
		if (!last) return;
		expect(last.to).toBe("User@Example.COM");
		expect(last.template).toBe("verify-email");
		expect(Object.keys(last.variables).sort()).toEqual(["code"]);
		expect(last.variables.code).toMatch(/^\d{6}$/);
		expect(last.idempotencyKey).toMatch(/^7:[0-9a-f]{16}$/);
	});

	it("(§8) honors env.DOVE_TEMPLATE_SLUG override so ops can swap templates without a deploy", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		const dove = stubDoveOk(env);
		env.DOVE_TEMPLATE_SLUG = "verify-email-canary";
		const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
		expect(res.status).toBe(200);
		expect(dove.lastInput?.template).toBe("verify-email-canary");
		expect(Object.keys(dove.lastInput?.variables ?? {})).toEqual(["code"]);
	});

	it("does NOT touch users.email (pending lives in KV only)", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x", { email: "fresh@example.com" }), env);
		expect(res.status).toBe(200);
		const rec = JSON.parse((await kv.get(codeKvKey(7))) as string) as CodeRecord;
		expect(rec.pendingEmailNormalized).toBe("fresh@example.com");
	});

	it("returns 502 EMAIL_PROVIDER_FAILED, releases the in-flight lock, and DOES NOT mutate KV when dove fails", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		stubDoveFail(env);
		const warnSpy = vi.fn(() => {});
		const origWarn = console.warn;
		console.warn = warnSpy as unknown as typeof console.warn;
		try {
			const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
			expect(res.status).toBe(502);
			const body = await res.json();
			expect(body.error.code).toBe("EMAIL_PROVIDER_FAILED");
			expect(body.error.details).toBeUndefined();
			expect(await kv.get(codeKvKey(7))).toBeNull();
			expect(await kv.get(sendLockKvKey(7))).toBeNull();
			expect(warnSpy).toHaveBeenCalledTimes(1);
			const logged = String((warnSpy.mock.calls[0] as unknown as string[])[0]);
			expect(logged).toContain("upstream_code=recipient_not_found");
			expect(logged).toContain("u***@example.com");
			expect(logged).not.toContain("user@example.com");
		} finally {
			console.warn = origWarn;
		}
	});

	it("returns 429 CODE_RESEND_THROTTLED when called within 60s of last send", async () => {
		const now = Math.floor(Date.now() / 1000);
		const existing: CodeRecord = {
			codeHmac: "f".repeat(64),
			pendingEmail: "user@example.com",
			pendingEmailNormalized: "user@example.com",
			expiresAt: now + 600,
			attempts: 0,
			lastSentAt: now - 5,
		};
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [codeKvKey(7)]: JSON.stringify(existing) },
		});
		const fetchTracker = stubDoveOk(env);

		const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error.code).toBe("CODE_RESEND_THROTTLED");
		expect(body.error.details.next_resend_allowed_at).toBe(existing.lastSentAt + 60);
		expect(fetchTracker.calls).toBe(0);
		const raw = await kv.get(codeKvKey(7));
		expect(JSON.parse(raw as string).lastSentAt).toBe(existing.lastSentAt);
	});

	it("returns 429 CODE_RESEND_THROTTLED and DOES NOT call dove when an in-flight send-lock exists", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [sendLockKvKey(7)]: "1" },
		});
		const tracker = stubDoveOk(env);

		const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
		expect(res.status).toBe(429);
		expect((await res.json()).error.code).toBe("CODE_RESEND_THROTTLED");
		expect(tracker.calls).toBe(0);
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("races: two concurrent requestCode calls only invoke dove once", async () => {
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		const tracker = stubDoveOk(env);
		const [a, b] = await Promise.all([
			requestCode(await makeRequest("/x", { email: "user@example.com" }), env),
			requestCode(await makeRequest("/x", { email: "user@example.com" }), env),
		]);
		const statuses = [a.status, b.status].sort();
		expect(statuses).toEqual([200, 429]);
		expect(tracker.calls).toBe(1);
		expect(await kv.get(sendLockKvKey(7))).toBeNull();
		const rec = JSON.parse((await kv.get(codeKvKey(7))) as string) as CodeRecord;
		expect(rec.attempts).toBe(0);
	});

	it("allows resend after the throttle window has elapsed", async () => {
		const now = Math.floor(Date.now() / 1000);
		const existing: CodeRecord = {
			codeHmac: "f".repeat(64),
			pendingEmail: "user@example.com",
			pendingEmailNormalized: "user@example.com",
			expiresAt: now + 600,
			attempts: 0,
			lastSentAt: now - 120,
		};
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [codeKvKey(7)]: JSON.stringify(existing) },
		});
		stubDoveOk(env);
		const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
		expect(res.status).toBe(200);
		const newRec = JSON.parse((await kv.get(codeKvKey(7))) as string) as CodeRecord;
		expect(newRec.lastSentAt).toBeGreaterThan(existing.lastSentAt);
		expect(newRec.codeHmac).not.toBe(existing.codeHmac);
	});

	it("returns 500 INTERNAL_ERROR when EMAIL_VERIFY_HMAC_KEY is missing", async () => {
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
		});
		(env as { EMAIL_VERIFY_HMAC_KEY?: string }).EMAIL_VERIFY_HMAC_KEY = undefined;
		const res = await requestCode(await makeRequest("/x", { email: "user@example.com" }), env);
		expect(res.status).toBe(500);
	});
});

// ───────────────────────────── verify ─────────────────────────────

describe("verifyCode (POST /api/v1/users/me/email/verify)", () => {
	async function seedRecord(args: {
		userId?: number;
		code: string;
		emailDisplay?: string;
		emailNormalized?: string;
		ageSeconds?: number;
		attempts?: number;
		ttlSeconds?: number;
	}): Promise<{ record: CodeRecord; kvSeed: Record<string, string> }> {
		const userId = args.userId ?? 7;
		const emailNormalized = args.emailNormalized ?? "user@example.com";
		const emailDisplay = args.emailDisplay ?? emailNormalized;
		const codeHmac = await computeCodeHmac(HMAC_KEY, userId, emailNormalized, args.code);
		const now = Math.floor(Date.now() / 1000);
		const record: CodeRecord = {
			codeHmac,
			pendingEmail: emailDisplay,
			pendingEmailNormalized: emailNormalized,
			expiresAt: now + (args.ttlSeconds ?? 600),
			attempts: args.attempts ?? 0,
			lastSentAt: now - (args.ageSeconds ?? 30),
		};
		return { record, kvSeed: { [codeKvKey(userId)]: JSON.stringify(record) } };
	}

	it("returns 400 EMAIL_INVALID when body.email is missing", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(await makeRequest("/x", { code: "123456" }), env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("EMAIL_INVALID");
	});

	it("returns 400 CODE_FORMAT_INVALID for non-6-digit input", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "12345" }),
			env,
		);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("CODE_FORMAT_INVALID");
	});

	it("returns 400 CODE_FORMAT_INVALID for non-digit input", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "abcdef" }),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("returns 404 CODE_NOT_FOUND when no KV record exists", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe("CODE_NOT_FOUND");
	});

	it("on success, writes email + email_normalized + verified_at and deletes KV record", async () => {
		const { kvSeed } = await seedRecord({
			code: "123456",
			emailDisplay: "User@Example.com",
			emailNormalized: "user@example.com",
		});
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.verified).toBe(true);
		expect(body.data.verified_at).toBeGreaterThan(0);
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("accepts case/whitespace differences when matching body.email to pending", async () => {
		const { kvSeed } = await seedRecord({
			code: "123456",
			emailDisplay: "user@example.com",
			emailNormalized: "user@example.com",
		});
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "  USER@Example.COM  ", code: "123456" }),
			env,
		);
		expect(res.status).toBe(200);
	});

	it("returns 409 EMAIL_CODE_EMAIL_MISMATCH when body.email differs from KV pending (no attempt burned)", async () => {
		const { kvSeed } = await seedRecord({
			code: "123456",
			emailNormalized: "pending@example.com",
		});
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "different@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_CODE_EMAIL_MISMATCH");
		const rec = JSON.parse((await kv.get(codeKvKey(7))) as string) as CodeRecord;
		expect(rec.attempts).toBe(0);
	});

	it("returns 409 EMAIL_ALREADY_IN_USE when D1 unique index rejects the UPDATE", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
			updateThrows: new Error("D1_ERROR: UNIQUE constraint failed: users.email_normalized"),
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_IN_USE");
		expect(await kv.get(codeKvKey(7))).not.toBeNull();
	});

	it("returns 403 EMAIL_ALREADY_VERIFIED when conditional UPDATE matches zero rows (out-of-band verify)", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
			updateChanges: 0,
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_VERIFIED");
	});

	it("returns 403 CODE_INVALID and increments attempts on wrong code", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: kvSeed,
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "999999" }),
			env,
		);
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
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "999999" }),
			env,
		);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("CODE_LOCKED");
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 404 CODE_NOT_FOUND when stored record has already expired (defensive)", async () => {
		const { record } = await seedRecord({ code: "123456" });
		const expired: CodeRecord = { ...record, expiresAt: 1 };
		const { env, kv } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 0 },
			kv: { [codeKvKey(7)]: JSON.stringify(expired) },
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe("CODE_NOT_FOUND");
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});

	it("returns 403 EMAIL_ALREADY_VERIFIED when user verified out-of-band", async () => {
		const { kvSeed } = await seedRecord({ code: "123456" });
		const { env } = makeEnv({
			dbUser: { role: 0, status: 0, email_verified_at: 1700000000 },
			kv: kvSeed,
		});
		const res = await verifyCode(
			await makeRequest("/x", { email: "user@example.com", code: "123456" }),
			env,
		);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_VERIFIED");
	});

	it("returns 401 when token is missing", async () => {
		const { env } = makeEnv({ dbUser: { role: 0, status: 0, email_verified_at: 0 } });
		const req = new Request("https://example.com/x", {
			method: "POST",
			body: JSON.stringify({ email: "user@example.com", code: "123456" }),
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

// ───────────────────────── correctPendingEmail ─────────────────────────

/**
 * Build an env tailored to the `correctPendingEmail` handler. Different from
 * `makeEnv` in two ways:
 *   - the row read uses `(email_verified_at, email_changed_at)` not
 *     `(email_verified_at, username)`, so we key the firstResult on the new
 *     SELECT prefix;
 *   - the UPDATE binds 4 params (email, normalized, ts, userId) and we let
 *     callers swap in throws / zero-changes.
 */
function makeCorrectEnv(opts: {
	row: { email_verified_at: number; email_changed_at: number; email_normalized?: string } | null;
	emailOwner?: { id: number } | null;
	updateThrows?: Error;
	updateChanges?: number;
	freshRow?: {
		email_verified_at: number;
		email_changed_at: number;
		email_normalized?: string;
	} | null;
}): { env: Env; kv: KVNamespace; calls: { sql: string; params: unknown[] }[] } {
	const { db: baseDb, calls } = createMockDb({
		firstResults: {
			"SELECT role, status FROM users": opts.row === null ? null : { role: 0, status: 0 },
			// Row read by correctPendingEmail itself
			"SELECT email_verified_at, email_changed_at, email_normalized FROM users": opts.row,
			// The handler's race re-read is narrower (no email_normalized) — both
			// shapes are populated so freshRow flows through whichever the
			// implementation picks.
			"SELECT email_verified_at, email_changed_at FROM users": opts.freshRow ?? opts.row,
			// Pre-check uniqueness against other users
			"SELECT id FROM users WHERE email_normalized": opts.emailOwner ?? null,
		},
	});

	// Track how many times we've answered the row SELECT so the second read
	// (after a zero-changes UPDATE) can return a different row simulating a
	// concurrent change.
	let rowReads = 0;
	const origPrepare = baseDb.prepare;
	const db = {
		...baseDb,
		prepare: (sql: string) => {
			const stmt = origPrepare(sql);
			if (
				sql.startsWith("SELECT email_verified_at, email_changed_at, email_normalized FROM users")
			) {
				const origBind = stmt.bind;
				stmt.bind = (...params: unknown[]) => {
					const bound = origBind(...params);
					bound.first = async () => {
						rowReads += 1;
						if (rowReads === 1) return opts.row;
						return opts.freshRow ?? opts.row;
					};
					return bound;
				};
			}
			if (sql.startsWith("UPDATE users SET email")) {
				const origBind = stmt.bind;
				stmt.bind = (...params: unknown[]) => {
					const bound = origBind(...params);
					bound.run = async () => {
						if (opts.updateThrows) throw opts.updateThrows;
						return {
							success: true,
							meta: { last_row_id: 1, changes: opts.updateChanges ?? 1 },
						};
					};
					return bound;
				};
			}
			return stmt;
		},
	} as unknown as D1Database;

	const kv = createMockKV({});
	const env: Env = {
		API_KEY: "k",
		ADMIN_API_KEY: "k",
		DB: db,
		ENVIRONMENT: "test",
		JWT_SECRET,
		KV: kv,
		R2: {} as R2Bucket,
		EMAIL_VERIFY_HMAC_KEY: HMAC_KEY,
	};
	return { env, kv, calls };
}

describe("correctPendingEmail (POST /api/v1/users/me/email/correct)", () => {
	it("returns 401 without JWT", async () => {
		const { env } = makeCorrectEnv({ row: { email_verified_at: 0, email_changed_at: 0 } });
		const req = new Request("https://example.com/x", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ email: "new@example.com" }),
		});
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(401);
	});

	it("returns 400 INVALID_BODY for malformed JSON", async () => {
		const { env } = makeCorrectEnv({ row: { email_verified_at: 0, email_changed_at: 0 } });
		const token = await createJwt(
			{ userId: 7, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			JWT_SECRET,
		);
		const req = new Request("https://example.com/x", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "not json",
		});
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("INVALID_BODY");
	});

	it("returns 400 EMAIL_INVALID for malformed email", async () => {
		const { env } = makeCorrectEnv({ row: { email_verified_at: 0, email_changed_at: 0 } });
		const req = await makeRequest("/x", { email: "not-an-email" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("EMAIL_INVALID");
	});

	it("returns 404 USER_NOT_FOUND when the row is missing", async () => {
		const { env } = makeCorrectEnv({ row: null });
		const req = await makeRequest("/x", { email: "new@example.com" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe("USER_NOT_FOUND");
	});

	it("returns 400 EMAIL_UNCHANGED when the new email matches the current normalized email (case/whitespace-insensitive), without consuming the one-shot or touching KV", async () => {
		const { env, kv, calls } = makeCorrectEnv({
			row: {
				email_verified_at: 0,
				email_changed_at: 0,
				email_normalized: "alice@example.com",
			},
		});
		// Seed a pending KV envelope so we can assert it's untouched on the
		// EMAIL_UNCHANGED short-circuit.
		await kv.put(codeKvKey(7), "{}");
		const req = await makeRequest("/x", { email: "  ALICE@Example.com  " });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("EMAIL_UNCHANGED");

		// No UPDATE was issued — the one-shot correction is preserved.
		const updateCall = calls.find((c) => c.sql.startsWith("UPDATE users SET email"));
		expect(updateCall).toBeUndefined();

		// Pending KV envelope must not be evicted on the unchanged short-circuit.
		expect(await kv.get(codeKvKey(7))).toBe("{}");
	});

	it("returns 403 EMAIL_NOT_CORRECTABLE when the email is already verified", async () => {
		const { env } = makeCorrectEnv({
			row: { email_verified_at: 1700000000, email_changed_at: 0 },
		});
		const req = await makeRequest("/x", { email: "new@example.com" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_NOT_CORRECTABLE");
	});

	it("returns 403 EMAIL_CORRECTION_USED when correction was already used", async () => {
		const { env } = makeCorrectEnv({
			row: { email_verified_at: 0, email_changed_at: 1700000000 },
		});
		const req = await makeRequest("/x", { email: "new@example.com" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_CORRECTION_USED");
	});

	it("returns 409 EMAIL_ALREADY_IN_USE when another user owns the normalized email", async () => {
		const { env } = makeCorrectEnv({
			row: { email_verified_at: 0, email_changed_at: 0 },
			emailOwner: { id: 99 },
		});
		const req = await makeRequest("/x", { email: "new@example.com" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_IN_USE");
	});

	it("returns 409 EMAIL_ALREADY_IN_USE on partial-unique-index throw at UPDATE time", async () => {
		const { env } = makeCorrectEnv({
			row: { email_verified_at: 0, email_changed_at: 0 },
			updateThrows: new Error("UNIQUE constraint failed: users.email_normalized"),
		});
		const req = await makeRequest("/x", { email: "new@example.com" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(409);
		expect((await res.json()).error.code).toBe("EMAIL_ALREADY_IN_USE");
	});

	it("re-derives a precise error code on a 0-changes race (correction used between SELECT and UPDATE)", async () => {
		const { env } = makeCorrectEnv({
			row: { email_verified_at: 0, email_changed_at: 0 },
			updateChanges: 0,
			freshRow: { email_verified_at: 0, email_changed_at: 1700000001 },
		});
		const req = await makeRequest("/x", { email: "new@example.com" });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe("EMAIL_CORRECTION_USED");
	});

	it("succeeds and writes new email + email_changed_at, dropping any pending KV code", async () => {
		const { env, kv, calls } = makeCorrectEnv({
			row: { email_verified_at: 0, email_changed_at: 0 },
		});
		// Seed a pre-existing pending verification envelope so we can prove
		// it's evicted (would otherwise mismatch on next verify).
		await kv.put(codeKvKey(7), "{}");
		const req = await makeRequest("/x", { email: "  NEW@example.com  " });
		const res = await correctPendingEmail(req, env);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data.email_changed_at).toBeGreaterThan(0);

		const updateCall = calls.find((c) => c.sql.startsWith("UPDATE users SET email"));
		expect(updateCall).toBeDefined();
		// (email, email_normalized, email_changed_at, userId)
		expect(updateCall?.params[0]).toBe("NEW@example.com");
		expect(updateCall?.params[1]).toBe("new@example.com");
		expect(typeof updateCall?.params[2]).toBe("number");
		expect(updateCall?.params[3]).toBe(7);

		// Pending KV code envelope must be dropped.
		expect(await kv.get(codeKvKey(7))).toBeNull();
	});
});
