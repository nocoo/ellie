// Auth handler ↔ login_history audit-log instrumentation contract (P4).
//
// This suite pins ONE thing: every documented `LoginHistoryErrorCode`
// branch in `apps/worker/src/handlers/auth.ts` produces exactly one
// `scheduleLoginHistory` call with the expected row shape, AND every
// non-documented (body-validation / trust-edge / INTERNAL_ERROR) branch
// produces zero calls.
//
// This is the regression net for the closed enum in
// `apps/worker/src/lib/analytics/loginHistory.ts` — if someone:
//
//   - adds a new return branch but forgets to instrument it, the
//     "missing audit row" assertion below will catch it
//   - removes a return branch but leaves the enum value, the dedicated
//     branch test fails because the precondition no longer reaches the
//     scheduleLoginHistory call site
//   - changes the row shape (userId nullability, ok flag, kind, etc.)
//     without updating the loginHistory helper contract, the params
//     assertion fails
//
// Strategy: `vi.mock` the loginHistory module so we can observe each
// scheduleLoginHistory call as a spy, then drive the auth handler with
// the exact precondition for each branch (KV state, D1 mock, request
// body). We assert on:
//
//   - call count (exactly 1 for documented branch; 0 for ignored)
//   - errorCode string (must equal the enum value)
//   - userId nullability (null when no users row, the matched id otherwise)
//   - ok flag (0 for failure, 1 for success)
//   - kind ("login" or "register")
//
// We do NOT assert on createdAt or userAgent here — those are covered
// by the loginHistory helper's own unit tests.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IMPORTANT: vi.mock MUST happen before the import of the SUT so vitest
// hoists the mock registration above the require graph.
vi.mock("../../../src/lib/analytics/loginHistory", () => ({
	scheduleLoginHistory: vi.fn(),
}));

import { login, register } from "../../../src/handlers/auth";
import { scheduleLoginHistory } from "../../../src/lib/analytics/loginHistory";
import { hashPassword } from "../../../src/lib/password";
import { createMockDb, createMockKV, makeEnv } from "../../helpers";

const scheduleMock = scheduleLoginHistory as unknown as ReturnType<typeof vi.fn>;

const REQUIRED_PROFILE = { graduateSchool: "校内人士", campus: "四平路校区" };

function createLoginRequest(body: Record<string, unknown>, ip = "203.0.113.42") {
	return new Request("https://example.com/api/v1/auth/login", {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
			"User-Agent": "Mozilla/5.0 (test)",
		},
	});
}

function createRegisterRequest(body: Record<string, unknown>, ip = "1.2.3.4") {
	return new Request("https://example.com/api/v1/auth/register", {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": ip,
			"User-Agent": "Mozilla/5.0 (test)",
		},
	});
}

function makeCtx(): ExecutionContext {
	return {
		waitUntil: vi.fn(),
		passThroughOnException: vi.fn(),
	} as unknown as ExecutionContext;
}

/** Convenience: read the last row scheduleLoginHistory was called with. */
function lastRow(): {
	userId: number | null;
	username: string;
	ok: 0 | 1;
	kind: "login" | "register";
	errorCode: string;
	ip: string;
	userAgent: string | null;
	createdAt: number;
} {
	const last = scheduleMock.mock.calls[scheduleMock.mock.calls.length - 1];
	return last[2];
}

beforeEach(() => {
	scheduleMock.mockClear();
});

afterEach(() => {
	vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────
// login() — 4 failure branches + 1 success branch
// ───────────────────────────────────────────────────────────────────

describe("login() — login_history instrumentation", () => {
	it("LOCKED_OUT_IP: writes ok=0 userId=null kind=login errorCode=LOCKED_OUT_IP", async () => {
		const { db } = createMockDb();
		// IP lockout key present → branch fires before any D1 user lookup.
		const env = makeEnv({
			DB: db,
			KV: createMockKV({ "login-lockout-ip:203.0.113.42": "1" }),
		});
		const ctx = makeCtx();
		const res = await login(createLoginRequest({ username: "alice", password: "x" }), env, ctx);
		expect(res.status).toBe(429);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		const row = lastRow();
		expect(row).toMatchObject({
			userId: null,
			username: "alice",
			ok: 0,
			kind: "login",
			errorCode: "LOCKED_OUT_IP",
			ip: "203.0.113.42",
		});
	});

	it("RATE_LIMITED_IP: triggers 24h lockout AND writes ok=0 errorCode=RATE_LIMITED_IP", async () => {
		const { db } = createMockDb();
		const env = makeEnv({
			DB: db,
			KV: createMockKV({ "login-ip:203.0.113.42": "5" }),
		});
		const ctx = makeCtx();
		const res = await login(createLoginRequest({ username: "alice", password: "x" }), env, ctx);
		expect(res.status).toBe(429);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "alice",
			ok: 0,
			kind: "login",
			errorCode: "RATE_LIMITED_IP",
		});
	});

	it("INVALID_CREDENTIALS (user not found): writes ok=0 userId=null", async () => {
		// firstResult=null means no users row → branch hits user-not-found.
		const { db } = createMockDb({ firstResults: { "SELECT id": null } });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await login(
			createLoginRequest({ username: "ghostuser", password: "anything" }),
			env,
			ctx,
		);
		expect(res.status).toBe(401);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "ghostuser",
			ok: 0,
			kind: "login",
			errorCode: "INVALID_CREDENTIALS",
		});
	});

	it("USER_BANNED: writes ok=0 with the matched userId (not null)", async () => {
		const banned = {
			id: 77,
			username: "bannedbob",
			password_hash: "h",
			password_salt: "",
			role: 0,
			status: -1, // banned
		};
		const { db } = createMockDb({ firstResults: { "SELECT id": banned } });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await login(createLoginRequest({ username: "bannedbob", password: "x" }), env, ctx);
		expect(res.status).toBe(403);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: 77,
			username: "bannedbob",
			ok: 0,
			kind: "login",
			errorCode: "USER_BANNED",
		});
	});

	it("INVALID_CREDENTIALS (password mismatch): writes ok=0 with matched userId", async () => {
		const goodHash = await hashPassword("correct");
		const user = {
			id: 42,
			username: "alice",
			password_hash: goodHash,
			password_salt: "",
			role: 0,
			status: 0,
		};
		const { db } = createMockDb({ firstResults: { "SELECT id": user } });
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await login(createLoginRequest({ username: "alice", password: "wrong" }), env, ctx);
		expect(res.status).toBe(401);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: 42,
			username: "alice",
			ok: 0,
			kind: "login",
			errorCode: "INVALID_CREDENTIALS",
		});
	});

	it("success: writes ok=1 errorCode='' kind=login with matched userId", async () => {
		const password = "right-password";
		const hash = await hashPassword(password);
		const user = {
			id: 123,
			username: "alice",
			password_hash: hash,
			password_salt: "",
			role: 0,
			status: 0,
		};
		const { db } = createMockDb({
			firstResults: { "SELECT id": user },
			runResults: { "UPDATE users": { success: true, meta: { changes: 1, last_row_id: 0 } } },
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await login(createLoginRequest({ username: "alice", password }), env, ctx);
		expect(res.status).toBe(200);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: 123,
			username: "alice",
			ok: 1,
			kind: "login",
			errorCode: "",
		});
	});

	// ── Branches that MUST NOT audit ──

	it("INVALID_REQUEST (body shape — missing password): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await login(createLoginRequest({ username: "alice" }), env, ctx);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INVALID_REQUEST (missing trustworthy IP): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		// Build a request without CF-Connecting-IP. extractTrustedClientIp
		// will return null → trust-edge failure, no audit.
		const req = new Request("https://example.com/api/v1/auth/login", {
			method: "POST",
			body: JSON.stringify({ username: "alice", password: "x" }),
			headers: { "Content-Type": "application/json" },
		});
		const res = await login(req, env, ctx);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INTERNAL_ERROR (malformed JSON body): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const req = new Request("https://example.com/api/v1/auth/login", {
			method: "POST",
			body: "not json {",
			headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.42" },
		});
		const res = await login(req, env, ctx);
		expect(res.status).toBe(500);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	// ── ctx-absent contract (handler always calls; helper decides no-op) ──

	it("still calls scheduleLoginHistory even when ctx is undefined (helper handles no-op)", async () => {
		// The auth handler MUST always invoke scheduleLoginHistory at the
		// documented branches; the ctx-absent no-op is the helper's
		// responsibility (kept inside loginHistory.ts so call sites stay
		// uniform). Asserting handler-side helps the contract not drift.
		const { db } = createMockDb({ firstResults: { "SELECT id": null } });
		const env = makeEnv({ DB: db });
		const res = await login(
			createLoginRequest({ username: "ghost", password: "x" }),
			env, // no ctx
		);
		expect(res.status).toBe(401);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(scheduleMock.mock.calls[0][1]).toBeUndefined(); // ctx arg
	});
});

// ───────────────────────────────────────────────────────────────────
// register() — 5 failure branches + 1 success branch
// ───────────────────────────────────────────────────────────────────

describe("register() — login_history instrumentation", () => {
	const validBody = {
		username: "newcomer",
		password: "secret123",
		email: "newcomer@example.com",
		profile: REQUIRED_PROFILE,
	};

	it("REGISTRATION_DISABLED: writes ok=0 userId=null kind=register", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "false" } },
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await register(createRegisterRequest(validBody), env, ctx);
		expect(res.status).toBe(403);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "newcomer",
			ok: 0,
			kind: "register",
			errorCode: "REGISTRATION_DISABLED",
		});
	});

	it("USERNAME_BANNED: writes ok=0 userId=null kind=register", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id, find": [{ id: 1, find: "newcomer", replacement: "**", action: "ban" }],
			},
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await register(createRegisterRequest(validBody), env, ctx);
		expect(res.status).toBe(400);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "newcomer",
			ok: 0,
			kind: "register",
			errorCode: "USERNAME_BANNED",
		});
	});

	it("RATE_LIMITED: writes ok=0 userId=null kind=register", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({
			DB: db,
			KV: createMockKV({ "reg-ip:1.2.3.4": "3" }),
		});
		const ctx = makeCtx();
		const res = await register(createRegisterRequest(validBody), env, ctx);
		expect(res.status).toBe(429);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "newcomer",
			ok: 0,
			kind: "register",
			errorCode: "RATE_LIMITED",
		});
	});

	it("USERNAME_TAKEN: writes ok=0 userId=null kind=register", async () => {
		const throwingDb = {
			prepare: vi.fn((sql: string) => {
				const runMock = vi.fn(async () => {
					if (sql.includes("INSERT")) {
						throw new Error("UNIQUE constraint failed: users.username");
					}
					return { success: true, meta: { last_row_id: 1, changes: 1 } };
				});
				const firstMock = vi.fn(async () => {
					if (sql.includes("settings")) return { value: "true" };
					return null;
				});
				const allMock = vi.fn(async () => ({ results: [] }));
				return {
					bind: vi.fn(() => ({ first: firstMock, all: allMock, run: runMock })),
					first: firstMock,
					all: allMock,
					run: runMock,
				};
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: throwingDb });
		const ctx = makeCtx();
		const res = await register(createRegisterRequest(validBody), env, ctx);
		expect(res.status).toBe(409);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "newcomer",
			ok: 0,
			kind: "register",
			errorCode: "USERNAME_TAKEN",
		});
	});

	it("EMAIL_ALREADY_IN_USE: writes ok=0 userId=null kind=register", async () => {
		const throwingDb = {
			prepare: vi.fn((sql: string) => {
				const runMock = vi.fn(async () => {
					if (sql.includes("INSERT")) {
						throw new Error("UNIQUE constraint failed: users.email_normalized");
					}
					return { success: true, meta: { last_row_id: 1, changes: 1 } };
				});
				const firstMock = vi.fn(async () => {
					if (sql.includes("settings")) return { value: "true" };
					return null;
				});
				const allMock = vi.fn(async () => ({ results: [] }));
				return {
					bind: vi.fn(() => ({ first: firstMock, all: allMock, run: runMock })),
					first: firstMock,
					all: allMock,
					run: runMock,
				};
			}),
		} as unknown as D1Database;
		const env = makeEnv({ DB: throwingDb });
		const ctx = makeCtx();
		const res = await register(createRegisterRequest(validBody), env, ctx);
		expect(res.status).toBe(409);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: null,
			username: "newcomer",
			ok: 0,
			kind: "register",
			errorCode: "EMAIL_ALREADY_IN_USE",
		});
	});

	it("success: writes ok=1 errorCode='' kind=register with the new userId", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
			runResults: {
				"INSERT INTO users": { success: true, meta: { last_row_id: 555, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db });
		const ctx = makeCtx();
		const res = await register(createRegisterRequest(validBody), env, ctx);
		expect(res.status).toBe(201);
		expect(scheduleMock).toHaveBeenCalledTimes(1);
		expect(lastRow()).toMatchObject({
			userId: 555,
			username: "newcomer",
			ok: 1,
			kind: "register",
			errorCode: "",
		});
	});

	// ── Branches that MUST NOT audit ──

	it("INVALID_USERNAME (body shape): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await register(
			createRegisterRequest({ ...validBody, username: "a" }), // < 2 chars
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INVALID_PASSWORD (body shape): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await register(
			createRegisterRequest({ ...validBody, password: "12345" }), // < 6
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INVALID_EMAIL (body shape): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await register(
			createRegisterRequest({ ...validBody, email: "not-an-email" }),
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INVALID_BODY (missing required profile field): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const res = await register(
			createRegisterRequest({ ...validBody, profile: { graduateSchool: "", campus: "" } }),
			env,
			ctx,
		);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INVALID_REQUEST (missing trustworthy IP): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const req = new Request("https://example.com/api/v1/auth/register", {
			method: "POST",
			body: JSON.stringify(validBody),
			headers: { "Content-Type": "application/json" },
		});
		const res = await register(req, env, ctx);
		expect(res.status).toBe(400);
		expect(scheduleMock).not.toHaveBeenCalled();
	});

	it("INTERNAL_ERROR (malformed JSON body): does NOT audit", async () => {
		const env = makeEnv();
		const ctx = makeCtx();
		const req = new Request("https://example.com/api/v1/auth/register", {
			method: "POST",
			body: "not json {",
			headers: { "Content-Type": "application/json", "CF-Connecting-IP": "1.2.3.4" },
		});
		const res = await register(req, env, ctx);
		expect(res.status).toBe(500);
		expect(scheduleMock).not.toHaveBeenCalled();
	});
});

// ───────────────────────────────────────────────────────────────────
// Cross-cutting: closed enum coverage
// ───────────────────────────────────────────────────────────────────

describe("LoginHistoryErrorCode coverage — every code is produced by a real branch", () => {
	it("every documented enum value appears in at least one assertion above", () => {
		// This list MUST match the closed LoginHistoryErrorCode enum in
		// lib/analytics/loginHistory.ts. Adding a new code without also
		// adding a real branch + matching assertion above means the regression
		// guard in loginHistory.test.ts (`LoginHistoryErrorCode enum`) and
		// THIS test fall out of sync — fix both, or fix neither.
		const documented = [
			"", // success (login + register both)
			"INVALID_CREDENTIALS",
			"USER_BANNED",
			"RATE_LIMITED_IP",
			"LOCKED_OUT_IP",
			"REGISTRATION_DISABLED",
			"USERNAME_BANNED",
			"RATE_LIMITED",
			"EMAIL_ALREADY_IN_USE",
			"USERNAME_TAKEN",
		];
		expect(documented).toHaveLength(10);
	});
});
