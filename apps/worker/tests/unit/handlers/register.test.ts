import { describe, expect, it, vi } from "vitest";
import { checkUsername, register } from "../../../src/handlers/auth";
import { createMockDb, makeEnv } from "../../helpers";

// ---------------------------------------------------------------------------
// Request factories
// ---------------------------------------------------------------------------

/** Required education profile fields for registration */
const REQUIRED_PROFILE = { graduateSchool: "校内人士", campus: "四平路校区" };

function createRegisterRequest(body: Record<string, unknown>) {
	return new Request("https://example.com/api/v1/auth/register", {
		method: "POST",
		body: JSON.stringify(body),
		headers: {
			"Content-Type": "application/json",
			"CF-Connecting-IP": "1.2.3.4",
		},
	});
}

function createCheckUsernameRequest(username: string) {
	return new Request(
		`https://example.com/api/v1/auth/check-username?username=${encodeURIComponent(username)}`,
		{ method: "GET", headers: { "CF-Connecting-IP": "127.0.0.1" } },
	);
}

// ---------------------------------------------------------------------------
// Mock KV factory
// ---------------------------------------------------------------------------

function createMockKV(overrides?: {
	get?: Record<string, string | null>;
	putCalls?: Array<{ key: string; value: string; opts?: unknown }>;
}) {
	const putCalls = overrides?.putCalls ?? [];
	return {
		get: vi.fn(async (key: string) => overrides?.get?.[key] ?? null),
		put: vi.fn(async (key: string, value: string, opts?: unknown) => {
			putCalls.push({ key, value, opts });
		}),
		delete: vi.fn(async () => {}),
	} as unknown as KVNamespace;
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe("register", () => {
	// ── Input validation ──

	it("rejects empty username → INVALID_USERNAME 400", async () => {
		const env = makeEnv();
		const res = await register(createRegisterRequest({ username: "", password: "123456" }), env);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_USERNAME");
	});

	it("rejects username < 2 chars → INVALID_USERNAME 400", async () => {
		const env = makeEnv();
		const res = await register(createRegisterRequest({ username: "a", password: "123456" }), env);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_USERNAME");
	});

	it("rejects username > 15 chars → INVALID_USERNAME 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({ username: "a".repeat(16), password: "123456" }),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_USERNAME");
	});

	it("rejects username with special chars → INVALID_USERNAME 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({ username: "user@name!", password: "123456" }),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_USERNAME");
	});

	it("rejects username with spaces → INVALID_USERNAME 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({ username: "user name", password: "123456" }),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_USERNAME");
	});

	it("rejects empty password → INVALID_PASSWORD 400", async () => {
		const env = makeEnv();
		const res = await register(createRegisterRequest({ username: "validuser", password: "" }), env);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_PASSWORD");
	});

	it("rejects password < 6 chars → INVALID_PASSWORD 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({ username: "validuser", password: "12345" }),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_PASSWORD");
	});

	it("rejects invalid email format → INVALID_EMAIL 400", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "not-an-email",
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_EMAIL");
	});

	it("accepts empty email (optional)", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({ username: "validuser", password: "123456", email: "" }),
			env,
		);
		// Email is now required — empty should be rejected
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_EMAIL");
	});

	it("rejects missing email → INVALID_EMAIL 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({ username: "validuser", password: "123456" }),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_EMAIL");
	});

	it("accepts Chinese + English + digits + underscore username", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: {
				"SELECT value FROM settings": { value: "true" },
				"SELECT id FROM users": { id: 999 },
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "测试user_123",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(201);
	});

	// ── Censor check ──

	it("rejects username matching banned censor word → USERNAME_BANNED 400", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id, find": [{ id: 1, find: "badword", replacement: "**", action: "ban" }],
			},
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "badword",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("USERNAME_BANNED");
	});

	// ── Rate limiting ──

	it("allows registration when under IP limit", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: {
				"SELECT value FROM settings": { value: "true" },
				"SELECT id FROM users": { id: 999 },
			},
		});
		const kv = createMockKV({ get: { "reg-ip:1.2.3.4": "2" } });
		const env = makeEnv({ DB: db, KV: kv });
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(201);
	});

	it("rejects registration when IP limit reached → RATE_LIMITED 429", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const kv = createMockKV({ get: { "reg-ip:1.2.3.4": "3" } });
		const env = makeEnv({ DB: db, KV: kv });
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(429);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATE_LIMITED");
	});

	// ── Success path ──

	it("creates user and returns JWT + refreshToken on success → 201", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: {
				"SELECT value FROM settings": { value: "true" },
			},
			runResults: {
				// auth.register now reads the new userId from INSERT meta.last_row_id
				// rather than a follow-up SELECT, so the mock must surface it here.
				"INSERT INTO users": { success: true, meta: { last_row_id: 42, changes: 1 } },
			},
		});
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ putCalls });
		const env = makeEnv({ DB: db, KV: kv });
		const res = await register(
			createRegisterRequest({
				username: "newuser",
				password: "mypassword",
				email: "new@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			data: {
				token: string;
				refreshToken: string;
				user: { userId: number; username: string; role: number };
			};
		};
		expect(body.data.token).toBeDefined();
		expect(body.data.refreshToken).toBeDefined();
		expect(body.data.user.userId).toBe(42);
		expect(body.data.user.username).toBe("newuser");
		expect(body.data.user.role).toBe(0);

		// Verify refresh token stored in KV
		const refreshPut = putCalls.find((c) => c.key.startsWith("refresh:"));
		expect(refreshPut).toBeDefined();
		expect(refreshPut?.value).toBe("42");

		// Verify IP rate limit counter incremented
		const ratePut = putCalls.find((c) => c.key === "reg-ip:1.2.3.4");
		expect(ratePut).toBeDefined();
		expect(ratePut?.value).toBe("1");
	});

	// ── Registration disabled ──

	it("rejects registration when disabled → REGISTRATION_DISABLED 403", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "false" } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("REGISTRATION_DISABLED");
	});

	it("allows registration when setting is true", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: {
				"SELECT value FROM settings": { value: "true" },
				"SELECT id FROM users": { id: 999 },
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(201);
	});

	it("allows registration when setting does not exist (default true)", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			// No settings result = defaults to allowing registration
			firstResults: { "SELECT id FROM users": { id: 999 } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(201);
	});

	// ── UNIQUE constraint ──

	it("returns USERNAME_TAKEN 409 on UNIQUE constraint violation", async () => {
		const mockKv = createMockKV();
		const throwingDb = {
			prepare: vi.fn((sql: string) => {
				const runMock = vi.fn(async () => {
					if (sql.includes("INSERT")) {
						throw new Error("UNIQUE constraint failed: users.username");
					}
					return { success: true, meta: { last_row_id: 1, changes: 1 } };
				});
				const firstMock = vi.fn(async () => {
					// Return "true" for registration setting to allow registration
					if (sql.includes("settings")) return { value: "true" };
					return null;
				});
				const allMock = vi.fn(async () => {
					if (sql.includes("censor_words")) return { results: [] };
					return { results: [] };
				});

				return {
					bind: vi.fn((..._params: unknown[]) => ({
						first: firstMock,
						all: allMock,
						run: runMock,
					})),
					// Unbounded calls (for censor_words query which doesn't use bind)
					first: firstMock,
					all: allMock,
					run: runMock,
				};
			}),
		} as unknown as D1Database;

		const env = makeEnv({ DB: throwingDb, KV: mockKv });
		const res = await register(
			createRegisterRequest({
				username: "existinguser",
				password: "123456",
				email: "test@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("USERNAME_TAKEN");
	});

	it("returns EMAIL_ALREADY_IN_USE 409 on email_normalized UNIQUE violation", async () => {
		const mockKv = createMockKV();
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
				const allMock = vi.fn(async () => {
					if (sql.includes("censor_words")) return { results: [] };
					return { results: [] };
				});

				return {
					bind: vi.fn((..._params: unknown[]) => ({
						first: firstMock,
						all: allMock,
						run: runMock,
					})),
					first: firstMock,
					all: allMock,
					run: runMock,
				};
			}),
		} as unknown as D1Database;

		const env = makeEnv({ DB: throwingDb, KV: mockKv });
		const res = await register(
			createRegisterRequest({
				username: "newuser",
				password: "123456",
				email: "taken@example.com",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("EMAIL_ALREADY_IN_USE");
	});

	it("INSERT includes email_normalized column with lowercase value", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
			runResults: {
				"INSERT INTO users": { success: true, meta: { last_row_id: 99, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "casetest",
				password: "123456",
				email: "Test@Example.COM",
				profile: REQUIRED_PROFILE,
			}),
			env,
		);
		expect(res.status).toBe(201);

		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
		const insertCall = prepareCalls.find((c: unknown[]) =>
			(c[0] as string).includes("INSERT INTO users"),
		);
		expect(insertCall).toBeDefined();
		const sql = insertCall[0] as string;
		expect(sql).toContain("email_normalized");

		// Check actual bind calls from registration
		const insertStmt = (db.prepare as ReturnType<typeof vi.fn>).mock.results.find(
			(_r: unknown, i: number) =>
				((db.prepare as ReturnType<typeof vi.fn>).mock.calls[i][0] as string).includes(
					"INSERT INTO users",
				),
		);
		expect(insertStmt).toBeDefined();
		const boundBindMock = insertStmt.value.bind as ReturnType<typeof vi.fn>;
		const bindArgs = boundBindMock.mock.calls[0];
		// bindArgs should contain normalized email "test@example.com"
		expect(bindArgs).toContain("test@example.com");
		// And the original display email
		expect(bindArgs).toContain("Test@Example.COM");
	});

	// ── Profile fields at registration ──

	it("saves profile fields when provided in registration", async () => {
		const bindCalls: unknown[][] = [];
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
			runResults: {
				"INSERT INTO users": { success: true, meta: { last_row_id: 50, changes: 1 } },
			},
			onBind: (params) => bindCalls.push(params),
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "newuser",
				password: "123456",
				email: "new@example.com",
				profile: {
					gender: 1,
					campus: "四平路校区",
					graduateSchool: "校内人士",
					bio: "Hello!",
				},
			}),
			env,
		);
		expect(res.status).toBe(201);
		// Verify the INSERT included profile columns
		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
		const insertCall = prepareCalls.find((c: unknown[]) =>
			(c[0] as string).includes("INSERT INTO users"),
		);
		expect(insertCall).toBeDefined();
		const sql = insertCall[0] as string;
		expect(sql).toContain("gender");
		expect(sql).toContain("campus");
		expect(sql).toContain("bio");
	});

	it("rejects invalid gender in profile → INVALID_BODY 400", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "newuser",
				password: "123456",
				email: "new@example.com",
				profile: { gender: 5 },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("rejects invalid birthYear in profile → INVALID_BODY 400", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "newuser",
				password: "123456",
				email: "new@example.com",
				profile: { birthYear: 3000 },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("rejects profile string exceeding max length → INVALID_BODY 400", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "newuser",
				password: "123456",
				email: "new@example.com",
				profile: { bio: "x".repeat(501) },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("saves campus in profile at registration", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
			runResults: {
				"INSERT INTO users": { success: true, meta: { last_row_id: 60, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "campususer",
				password: "123456",
				email: "campus@example.com",
				profile: { campus: "嘉定校区", graduateSchool: "已毕业校友" },
			}),
			env,
		);
		expect(res.status).toBe(201);
		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
		const insertCall = prepareCalls.find((c: unknown[]) =>
			(c[0] as string).includes("INSERT INTO users"),
		);
		expect(insertCall).toBeDefined();
		const sql = insertCall[0] as string;
		expect(sql).toContain("campus");
	});

	it("rejects registration without profile (education required) → INVALID_BODY 400", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
			runResults: {
				"INSERT INTO users": { success: true, meta: { last_row_id: 70, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "basicuser",
				password: "123456",
				email: "basic@example.com",
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("INVALID_BODY");
	});

	it("strips email and avatar from profile to prevent double-handling", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT value FROM settings": { value: "true" } },
			runResults: {
				"INSERT INTO users": { success: true, meta: { last_row_id: 80, changes: 1 } },
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({
				username: "stripuser",
				password: "123456",
				email: "strip@example.com",
				profile: {
					email: "override@example.com",
					avatar: "hacked.jpg",
					gender: 2,
					...REQUIRED_PROFILE,
				},
			}),
			env,
		);
		expect(res.status).toBe(201);
		// Verify the INSERT doesn't double-write email but does include gender
		const prepareCalls = (db.prepare as ReturnType<typeof vi.fn>).mock.calls;
		const insertCall = prepareCalls.find((c: unknown[]) =>
			(c[0] as string).includes("INSERT INTO users"),
		);
		const sql = insertCall[0] as string;
		expect(sql).toContain("gender");
		// email and email_normalized appear once each (from top-level fields), not from profile
		const emailMatches = sql.match(/\bemail\b/g);
		expect(emailMatches?.length).toBe(1);
		expect(sql).toContain("email_normalized");
	});

	// ── Required education fields ──

	it("rejects missing identity type (graduateSchool) → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { campus: "四平路校区" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details?.message).toContain("Identity type");
	});

	it("rejects missing campus → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { graduateSchool: "校内人士" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details?.message).toContain("Campus");
	});

	// ── Birthday validation (strengthened) ──

	it("rejects incomplete birthday (only year) → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, birthYear: 1990 },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details?.message).toContain("Incomplete birthday");
	});

	it("rejects birth year before 1900 → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, birthYear: 1800, birthMonth: 1, birthDay: 1 },
			}),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("rejects birth month 0 → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, birthYear: 1990, birthMonth: 0, birthDay: 1 },
			}),
			env,
		);
		expect(res.status).toBe(400);
	});

	it("rejects Feb 30 → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, birthYear: 1990, birthMonth: 2, birthDay: 30 },
			}),
			env,
		);
		expect(res.status).toBe(400);
	});

	// ── QQ validation ──

	it("rejects non-numeric QQ → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, qq: "abc123" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details?.message).toContain("QQ");
	});

	// ── Site URL validation ──

	it("rejects invalid site URL → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, site: "not-a-url" },
			}),
			env,
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string; details?: { message: string } } };
		expect(body.error.code).toBe("INVALID_BODY");
		expect(body.error.details?.message).toContain("site");
	});

	it("rejects ftp site URL → INVALID_BODY 400", async () => {
		const env = makeEnv();
		const res = await register(
			createRegisterRequest({
				username: "validuser",
				password: "123456",
				email: "test@example.com",
				profile: { ...REQUIRED_PROFILE, site: "ftp://files.example.com" },
			}),
			env,
		);
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// checkUsername
// ---------------------------------------------------------------------------

describe("checkUsername", () => {
	it("returns available: false, reason: invalid for empty username", async () => {
		const env = makeEnv();
		const res = await checkUsername(createCheckUsernameRequest(""), env);
		const body = (await res.json()) as { data: { available: boolean; reason?: string } };
		expect(body.data.available).toBe(false);
		expect(body.data.reason).toBe("invalid");
	});

	it("returns available: false, reason: invalid for bad format", async () => {
		const env = makeEnv();
		const res = await checkUsername(createCheckUsernameRequest("a"), env);
		const body = (await res.json()) as { data: { available: boolean; reason?: string } };
		expect(body.data.available).toBe(false);
		expect(body.data.reason).toBe("invalid");
	});

	it("returns available: false, reason: banned for censored username", async () => {
		const { db } = createMockDb({
			allResults: {
				"SELECT id, find": [{ id: 1, find: "badname", replacement: "**", action: "ban" }],
			},
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await checkUsername(createCheckUsernameRequest("badname"), env);
		const body = (await res.json()) as { data: { available: boolean; reason?: string } };
		expect(body.data.available).toBe(false);
		expect(body.data.reason).toBe("banned");
	});

	it("returns available: false, reason: taken for existing username", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT 1 FROM users": { 1: 1 } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await checkUsername(createCheckUsernameRequest("takenuser"), env);
		const body = (await res.json()) as { data: { available: boolean; reason?: string } };
		expect(body.data.available).toBe(false);
		expect(body.data.reason).toBe("taken");
	});

	it("returns available: true for valid available username", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await checkUsername(createCheckUsernameRequest("newuser"), env);
		const body = (await res.json()) as { data: { available: boolean } };
		expect(body.data.available).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// checkUsername rate limit
// ---------------------------------------------------------------------------

function createCheckUsernameRequestWithIP(username: string, ip?: string) {
	const headers: Record<string, string> = {};
	if (ip) headers["CF-Connecting-IP"] = ip;
	return new Request(
		`https://example.com/api/v1/auth/check-username?username=${encodeURIComponent(username)}`,
		{ method: "GET", headers },
	);
}

describe("checkUsername rate limit", () => {
	it("allows request with no prior calls and increments counter", async () => {
		const { db } = createMockDb({ allResults: { "SELECT id, find": [] } });
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ putCalls });
		const env = makeEnv({ DB: db, KV: kv });

		const res = await checkUsername(createCheckUsernameRequestWithIP("newuser", "10.0.0.1"), env);
		expect(res.status).not.toBe(429);
		const ratePut = putCalls.find((c) => c.key === "chk-usr-ip:10.0.0.1");
		expect(ratePut).toBeDefined();
		expect(ratePut?.value).toBe("1");
		expect(ratePut?.opts).toEqual({ expirationTtl: 60 });
	});

	it("allows request at count=29 and increments to 30", async () => {
		const { db } = createMockDb({ allResults: { "SELECT id, find": [] } });
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ get: { "chk-usr-ip:10.0.0.1": "29" }, putCalls });
		const env = makeEnv({ DB: db, KV: kv });

		const res = await checkUsername(createCheckUsernameRequestWithIP("newuser", "10.0.0.1"), env);
		expect(res.status).not.toBe(429);
		const ratePut = putCalls.find((c) => c.key === "chk-usr-ip:10.0.0.1");
		expect(ratePut?.value).toBe("30");
	});

	it("rejects request at count=30 with RATE_LIMITED 429", async () => {
		const { db } = createMockDb({ allResults: { "SELECT id, find": [] } });
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ get: { "chk-usr-ip:10.0.0.1": "30" }, putCalls });
		const env = makeEnv({ DB: db, KV: kv });

		const res = await checkUsername(createCheckUsernameRequestWithIP("newuser", "10.0.0.1"), env);
		expect(res.status).toBe(429);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("RATE_LIMITED");
		// KV.put should NOT be called when rate limited
		const ratePut = putCalls.find((c) => c.key === "chk-usr-ip:10.0.0.1");
		expect(ratePut).toBeUndefined();
	});

	it("rejects request at count=99 with RATE_LIMITED 429", async () => {
		const { db } = createMockDb({ allResults: { "SELECT id, find": [] } });
		const kv = createMockKV({ get: { "chk-usr-ip:10.0.0.1": "99" } });
		const env = makeEnv({ DB: db, KV: kv });

		const res = await checkUsername(createCheckUsernameRequestWithIP("newuser", "10.0.0.1"), env);
		expect(res.status).toBe(429);
	});

	it("counts independently per IP", async () => {
		const { db } = createMockDb({ allResults: { "SELECT id, find": [] } });
		const kv = createMockKV({
			get: { "chk-usr-ip:10.0.0.1": "30", "chk-usr-ip:10.0.0.2": "5" },
		});
		const env = makeEnv({ DB: db, KV: kv });

		// IP A is rate limited
		const resA = await checkUsername(createCheckUsernameRequestWithIP("newuser", "10.0.0.1"), env);
		expect(resA.status).toBe(429);

		// IP B still allowed
		const resB = await checkUsername(createCheckUsernameRequestWithIP("newuser", "10.0.0.2"), env);
		expect(resB.status).not.toBe(429);
	});

	it("returns 400 INVALID_REQUEST when CF-Connecting-IP header is missing", async () => {
		const { db } = createMockDb({ allResults: { "SELECT id, find": [] } });
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ putCalls });
		const env = makeEnv({ DB: db, KV: kv });

		const res = await checkUsername(createCheckUsernameRequestWithIP("newuser"), env);
		expect(res.status).toBe(400);
		const body = (await res.json()) as {
			error: { code: string; details?: { message?: string } };
		};
		expect(body.error.code).toBe("INVALID_REQUEST");
		expect(body.error.details?.message).toBe("Missing client IP");
	});

	it("does not consume rate limit quota for missing username param", async () => {
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ putCalls });
		const env = makeEnv({ KV: kv });

		const res = await checkUsername(createCheckUsernameRequestWithIP("", "10.0.0.1"), env);
		expect(res.status).not.toBe(429);
		const ratePut = putCalls.find((c) => c.key.startsWith("chk-usr-ip:"));
		expect(ratePut).toBeUndefined();
	});
});
