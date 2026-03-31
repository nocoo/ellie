import { describe, expect, it, mock } from "bun:test";
import { checkUsername, register } from "../../../src/handlers/auth";
import { createMockDb, makeEnv } from "../../helpers";

// ---------------------------------------------------------------------------
// Request factories
// ---------------------------------------------------------------------------

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
		{ method: "GET" },
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
		get: mock(async (key: string) => overrides?.get?.[key] ?? null),
		put: mock(async (key: string, value: string, opts?: unknown) => {
			putCalls.push({ key, value, opts });
		}),
		delete: mock(async () => {}),
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
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT id FROM users": { id: 999 } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({ username: "validuser", password: "123456", email: "" }),
			env,
		);
		// Should proceed past validation (might succeed or get other errors)
		expect(res.status).toBe(201);
	});

	it("accepts Chinese + English + digits + underscore username", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
			firstResults: { "SELECT id FROM users": { id: 999 } },
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({ username: "测试user_123", password: "123456" }),
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
		});
		const env = makeEnv({ DB: db, KV: createMockKV() });
		const res = await register(
			createRegisterRequest({ username: "badword", password: "123456" }),
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
			firstResults: { "SELECT id FROM users": { id: 999 } },
		});
		const kv = createMockKV({ get: { "reg-ip:1.2.3.4": "2" } });
		const env = makeEnv({ DB: db, KV: kv });
		const res = await register(
			createRegisterRequest({ username: "validuser", password: "123456" }),
			env,
		);
		expect(res.status).toBe(201);
	});

	it("rejects registration when IP limit reached → RATE_LIMITED 429", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
		});
		const kv = createMockKV({ get: { "reg-ip:1.2.3.4": "3" } });
		const env = makeEnv({ DB: db, KV: kv });
		const res = await register(
			createRegisterRequest({ username: "validuser", password: "123456" }),
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
			firstResults: { "SELECT id FROM users": { id: 42 } },
		});
		const putCalls: Array<{ key: string; value: string; opts?: unknown }> = [];
		const kv = createMockKV({ putCalls });
		const env = makeEnv({ DB: db, KV: kv });
		const res = await register(
			createRegisterRequest({ username: "newuser", password: "mypassword" }),
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

	// ── UNIQUE constraint ──

	it("returns USERNAME_TAKEN 409 on UNIQUE constraint violation", async () => {
		const mockKv = createMockKV();
		const throwingDb = {
			prepare: mock((sql: string) => {
				const runMock = mock(async () => {
					if (sql.includes("INSERT")) {
						throw new Error("UNIQUE constraint failed: users.username");
					}
					return { success: true, meta: { last_row_id: 1, changes: 1 } };
				});
				const firstMock = mock(async () => null);
				const allMock = mock(async () => {
					if (sql.includes("censor_words")) return { results: [] };
					return { results: [] };
				});

				return {
					bind: mock((..._params: unknown[]) => ({
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
			createRegisterRequest({ username: "existinguser", password: "123456" }),
			env,
		);
		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("USERNAME_TAKEN");
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
		const env = makeEnv({ DB: db });
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
		const env = makeEnv({ DB: db });
		const res = await checkUsername(createCheckUsernameRequest("takenuser"), env);
		const body = (await res.json()) as { data: { available: boolean; reason?: string } };
		expect(body.data.available).toBe(false);
		expect(body.data.reason).toBe("taken");
	});

	it("returns available: true for valid available username", async () => {
		const { db } = createMockDb({
			allResults: { "SELECT id, find": [] },
		});
		const env = makeEnv({ DB: db });
		const res = await checkUsername(createCheckUsernameRequest("newuser"), env);
		const body = (await res.json()) as { data: { available: boolean } };
		expect(body.data.available).toBe(true);
	});
});
