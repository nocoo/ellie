// adminLog.test.ts — F1 unit coverage for the admin_logs write helper.
//
// Targets:
//   - resolveActor header precedence (name → email → "system"; CF-IP → XFF → "")
//   - sanitizeAdminLogDetails: top-level guard, nested redaction, allow-list
//     fields like actorEmail, depth cap, byte-length truncation (UTF-8 aware).
//   - writeAdminLog: success path INSERT shape, validation rejections, DB
//     failure swallowed with console.error.

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveActor,
	SYSTEM_ACTOR_ID,
	SYSTEM_ACTOR_NAME,
	sanitizeAdminLogDetails,
	writeAdminLog,
} from "../../../src/lib/adminLog";
import { makeEnv, TEST_ADMIN_API_KEY, TEST_API_KEY } from "../../helpers";

// ─── resolveActor ─────────────────────────────────────────────────

describe("resolveActor", () => {
	const env = makeEnv();
	function req(headers: Record<string, string>): Request {
		return new Request("https://api.example.com/api/admin/users/1", { headers });
	}

	it("picks adminName from X-Admin-Actor-Name when present", () => {
		const actor = resolveActor(
			req({
				"X-Admin-Actor-Name": "Alice",
				"X-Admin-Actor-Email": "alice@example.com",
				"CF-Connecting-IP": "1.2.3.4",
			}),
			env,
		);
		expect(actor).toEqual({
			adminId: SYSTEM_ACTOR_ID,
			adminName: "Alice",
			adminEmail: "alice@example.com",
			ip: "1.2.3.4",
		});
	});

	it("falls back to email when name header missing", () => {
		const actor = resolveActor(
			req({ "X-Admin-Actor-Email": "alice@example.com", "CF-Connecting-IP": "1.2.3.4" }),
			env,
		);
		expect(actor.adminName).toBe("alice@example.com");
		expect(actor.adminEmail).toBe("alice@example.com");
	});

	it("returns empty adminEmail when X-Admin-Actor-Email header absent", () => {
		const actor = resolveActor(req({ "CF-Connecting-IP": "1.2.3.4" }), env);
		expect(actor.adminEmail).toBe("");
	});

	it("trims whitespace around X-Admin-Actor-Email", () => {
		const actor = resolveActor(req({ "X-Admin-Actor-Email": "  bob@example.com  " }), env);
		expect(actor.adminEmail).toBe("bob@example.com");
	});

	it("falls back to system when both name and email missing", () => {
		const actor = resolveActor(req({ "CF-Connecting-IP": "1.2.3.4" }), env);
		expect(actor.adminName).toBe(SYSTEM_ACTOR_NAME);
	});

	it("uses X-Forwarded-For first segment when CF-Connecting-IP missing (non-prod)", () => {
		// XFF fallback only honored outside production; helpers default ENV='test'.
		const actor = resolveActor(req({ "X-Forwarded-For": "10.0.0.1, 10.0.0.2" }), env);
		expect(actor.ip).toBe("10.0.0.1");
	});

	it("ignores X-Forwarded-For in production (no trusted source → empty)", () => {
		const prodEnv = makeEnv({ ENVIRONMENT: "production" });
		const actor = resolveActor(req({ "X-Forwarded-For": "10.0.0.1, 10.0.0.2" }), prodEnv);
		expect(actor.ip).toBe("");
	});

	it("trusts X-Real-IP only when request carries Key A or Key B", () => {
		const prodEnv = makeEnv({ ENVIRONMENT: "production" });
		// Without API key → not trusted, ip empty
		expect(resolveActor(req({ "X-Ellie-Client-IP": "5.5.5.5" }), prodEnv).ip).toBe("");
		// With Key A (forum) → trusted
		expect(
			resolveActor(req({ "X-Ellie-Client-IP": "5.5.5.5", "X-API-Key": TEST_API_KEY }), prodEnv).ip,
		).toBe("5.5.5.5");
		// With Key B (admin) → trusted
		expect(
			resolveActor(
				req({ "X-Ellie-Client-IP": "5.5.5.5", "X-API-Key": TEST_ADMIN_API_KEY }),
				prodEnv,
			).ip,
		).toBe("5.5.5.5");
		// With wrong key → not trusted
		expect(
			resolveActor(req({ "X-Ellie-Client-IP": "5.5.5.5", "X-API-Key": "bogus" }), prodEnv).ip,
		).toBe("");
	});

	it("ip falls back to empty string when both ip headers missing", () => {
		const actor = resolveActor(req({}), env);
		expect(actor.ip).toBe("");
	});

	it("trims whitespace in headers", () => {
		const actor = resolveActor(
			req({ "X-Admin-Actor-Name": "  Bob  ", "CF-Connecting-IP": "  9.9.9.9  " }),
			env,
		);
		expect(actor.adminName).toBe("Bob");
		expect(actor.ip).toBe("9.9.9.9");
	});
});

// ─── sanitizeAdminLogDetails ──────────────────────────────────────

describe("sanitizeAdminLogDetails", () => {
	it("returns {} for non-object input", () => {
		expect(sanitizeAdminLogDetails(null)).toBe("{}");
		expect(sanitizeAdminLogDetails(undefined)).toBe("{}");
		expect(sanitizeAdminLogDetails("plain string")).toBe("{}");
		expect(sanitizeAdminLogDetails(42)).toBe("{}");
		expect(sanitizeAdminLogDetails([1, 2, 3])).toBe("{}");
	});

	it("redacts denylisted top-level keys", () => {
		const out = sanitizeAdminLogDetails({
			password: "hunter2",
			token: "abc",
			authorization: "Bearer x",
			email: "alice@example.com",
			reason: "spam",
		});
		const parsed = JSON.parse(out);
		expect(parsed.password).toBe("[REDACTED]");
		expect(parsed.token).toBe("[REDACTED]");
		expect(parsed.authorization).toBe("[REDACTED]");
		expect(parsed.email).toBe("[REDACTED]");
		expect(parsed.reason).toBe("spam");
	});

	it("redacts nested denylisted keys but keeps actorEmail / emailNormalized", () => {
		const out = sanitizeAdminLogDetails({
			actorEmail: "admin@example.com",
			emailNormalized: "admin@example.com",
			actor: {
				email: "leaky@example.com",
				token: "secret-token",
				name: "Eve",
			},
			audit: [{ password: "p", note: "ok" }],
		});
		const parsed = JSON.parse(out);
		expect(parsed.actorEmail).toBe("admin@example.com");
		expect(parsed.emailNormalized).toBe("admin@example.com");
		expect(parsed.actor.email).toBe("[REDACTED]");
		expect(parsed.actor.token).toBe("[REDACTED]");
		expect(parsed.actor.name).toBe("Eve");
		expect(parsed.audit[0].password).toBe("[REDACTED]");
		expect(parsed.audit[0].note).toBe("ok");
	});

	it("collapses subtrees beyond DETAILS_MAX_DEPTH", () => {
		const deep = { a: { b: { c: { d: { e: "too-deep" } } } } };
		const out = sanitizeAdminLogDetails(deep);
		const parsed = JSON.parse(out);
		// Depth 1=root, 2=a, 3=b, 4=c (allowed); 5=d collapsed.
		expect(parsed.a.b.c.d).toBe("[DEPTH_LIMIT]");
	});

	it("truncates oversize payloads while staying valid JSON", () => {
		const big = { blob: "x".repeat(10_000) };
		const out = sanitizeAdminLogDetails(big);
		expect(new TextEncoder().encode(out).byteLength).toBeLessThanOrEqual(4096);
		const parsed = JSON.parse(out);
		expect(parsed.truncated).toBe(true);
		expect(typeof parsed.head).toBe("string");
		expect(parsed.head.length).toBeGreaterThan(0);
	});

	it("UTF-8 byte length is the cap, not character length", () => {
		// Each Chinese char is 3 UTF-8 bytes — 2000 chars ≈ 6000 bytes, must truncate.
		const cn = { note: "你".repeat(2000) };
		const out = sanitizeAdminLogDetails(cn);
		expect(new TextEncoder().encode(out).byteLength).toBeLessThanOrEqual(4096);
		const parsed = JSON.parse(out);
		expect(parsed.truncated).toBe(true);
	});
});

// ─── writeAdminLog ────────────────────────────────────────────────

describe("writeAdminLog", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	function makeRecordingDb() {
		const calls: Array<{ sql: string; binds: unknown[] }> = [];
		const stmt = {
			bind(...binds: unknown[]) {
				return {
					async run() {
						calls.push({ sql: this._sql, binds });
						return { success: true };
					},
					_sql: this._sql,
				};
			},
			_sql: "",
		};
		const db = {
			prepare(sql: string) {
				return { ...stmt, _sql: sql };
			},
		} as unknown as D1Database;
		return { db, calls };
	}

	it("writes a row with the actor + sanitized details", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "alice", adminEmail: "alice@example.com", ip: "1.2.3.4" },
			{
				action: "user.ban",
				targetType: "user",
				targetId: 42,
				details: { reason: "spam", password: "should-not-leak" },
			},
		);
		expect(calls).toHaveLength(1);
		const [insert] = calls;
		expect(insert.sql).toContain("INSERT INTO admin_logs");
		expect(insert.binds[0]).toBe(0);
		expect(insert.binds[1]).toBe("alice");
		expect(insert.binds[2]).toBe("user.ban");
		expect(insert.binds[3]).toBe("user");
		expect(insert.binds[4]).toBe(42);
		const detailsJson = JSON.parse(insert.binds[5] as string);
		expect(detailsJson.reason).toBe("spam");
		expect(detailsJson.password).toBe("[REDACTED]");
		expect(detailsJson.actorEmail).toBe("alice@example.com");
		expect(insert.binds[6]).toBe("1.2.3.4");
		expect(typeof insert.binds[7]).toBe("number");
	});

	it("auto-merges actorEmail into details when actor.adminEmail is non-empty", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "Alice", adminEmail: "alice@example.com", ip: "1.1.1.1" },
			{
				action: "user.ban",
				targetType: "user",
				targetId: 7,
				details: { reason: "spam" },
			},
		);
		const detailsJson = JSON.parse(calls[0].binds[5] as string);
		expect(detailsJson.actorEmail).toBe("alice@example.com");
		expect(detailsJson.reason).toBe("spam");
	});

	it("auto-merges actorEmail even when handler omits details entirely", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "Alice", adminEmail: "alice@example.com", ip: "" },
			{ action: "user.unban", targetType: "user", targetId: 8 },
		);
		const detailsJson = JSON.parse(calls[0].binds[5] as string);
		expect(detailsJson.actorEmail).toBe("alice@example.com");
	});

	it("does NOT inject empty actorEmail for the system actor", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "system", adminEmail: "", ip: "" },
			{
				action: "report.auto_resolve",
				targetType: "report",
				targetId: 1,
				details: { reason: "stale" },
			},
		);
		const detailsJson = JSON.parse(calls[0].binds[5] as string);
		expect("actorEmail" in detailsJson).toBe(false);
		expect(detailsJson.reason).toBe("stale");
	});

	it("accepts targetId=null", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "system", adminEmail: "", ip: "" },
			{
				action: "report.batch_delete",
				targetType: "report",
				targetId: null,
				details: { ids: [1, 2, 3], count: 3 },
			},
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].binds[4]).toBeNull();
	});

	it("rejects empty action without throwing or writing", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "system", adminEmail: "", ip: "" },
			{
				action: "",
				targetType: "user",
				targetId: 1,
			},
		);
		expect(calls).toHaveLength(0);
		expect(errSpy).toHaveBeenCalled();
	});

	it("rejects oversize action without writing", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		vi.spyOn(console, "error").mockImplementation(() => {});
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "system", adminEmail: "", ip: "" },
			{
				action: "x".repeat(65),
				targetType: "user",
				targetId: 1,
			},
		);
		expect(calls).toHaveLength(0);
	});

	it("rejects non-integer targetId without writing", async () => {
		const { db, calls } = makeRecordingDb();
		const env = makeEnv({ DB: db });
		vi.spyOn(console, "error").mockImplementation(() => {});
		await writeAdminLog(
			env,
			{ adminId: 0, adminName: "system", adminEmail: "", ip: "" },
			{
				action: "user.ban",
				targetType: "user",
				targetId: 1.5 as unknown as number,
			},
		);
		expect(calls).toHaveLength(0);
	});

	it("swallows DB errors and logs to console.error", async () => {
		const env = makeEnv({
			DB: {
				prepare() {
					return {
						bind() {
							return {
								async run() {
									throw new Error("boom");
								},
							};
						},
					};
				},
			} as unknown as D1Database,
		});
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		await expect(
			writeAdminLog(
				env,
				{ adminId: 0, adminName: "system", adminEmail: "", ip: "" },
				{
					action: "user.ban",
					targetType: "user",
					targetId: 1,
				},
			),
		).resolves.toBeUndefined();
		expect(errSpy).toHaveBeenCalledWith(
			"[adminLog] INSERT failed",
			expect.objectContaining({ action: "user.ban" }),
		);
	});
});
