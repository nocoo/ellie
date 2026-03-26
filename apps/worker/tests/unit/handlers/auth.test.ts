import { describe, expect, it, mock } from "bun:test";
import { login } from "../../../src/handlers/auth";
import type { Env } from "../../../src/lib/env";
import { hashPassword } from "../../../src/lib/password";

// Helper to create a mock D1 database
function createMockDb(
	overrides: {
		firstResult?: unknown;
		runResult?: { success: boolean };
	} = {},
) {
	const runSpy = mock(() => Promise.resolve(overrides.runResult ?? { success: true }));
	const firstSpy = mock(() => Promise.resolve(overrides.firstResult ?? null));

	const bindSpy = mock((..._args: unknown[]) => ({
		first: firstSpy,
		run: runSpy,
	}));

	const prepareSpy = mock((_sql: string) => ({
		bind: bindSpy,
	}));

	return {
		prepareSpy,
		bindSpy,
		firstSpy,
		runSpy,
		db: { prepare: prepareSpy } as unknown as D1Database,
	};
}

function createLoginRequest(body: Record<string, unknown>) {
	return new Request("https://example.com/api/v1/auth/login", {
		method: "POST",
		body: JSON.stringify(body),
		headers: { "Content-Type": "application/json" },
	});
}

describe("auth handlers", () => {
	const mockEnv: Env = {
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret-key-for-jwt-hs256",
		KV: {
			put: mock(() => Promise.resolve()),
		} as unknown as KVNamespace,
		RATE_LIMITER: {} as DurableObjectNamespace,
	};

	describe("login", () => {
		it("should require username and password", async () => {
			const response = await login(createLoginRequest({ username: "test" }), mockEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should require username when only password provided", async () => {
			const response = await login(createLoginRequest({ password: "test" }), mockEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should require both fields when body is empty", async () => {
			const response = await login(createLoginRequest({}), mockEnv);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should return 401 for invalid credentials (user not found)", async () => {
			const { db } = createMockDb({ firstResult: null });
			const env = { ...mockEnv, DB: db };

			const response = await login(
				createLoginRequest({ username: "nonexistent", password: "wrong" }),
				env,
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("should return 403 for banned users", async () => {
			const user = {
				id: 1,
				username: "banned",
				password_hash: "hash",
				password_salt: "",
				role: 0,
				status: -1, // banned
			};

			const { db } = createMockDb({ firstResult: user });
			const env = { ...mockEnv, DB: db };

			const response = await login(
				createLoginRequest({ username: "banned", password: "pass" }),
				env,
			);

			expect(response.status).toBe(403);
			const data = await response.json();
			expect(data.error.code).toBe("USER_BANNED");
		});

		it("should handle malformed JSON", async () => {
			const response = await login(
				new Request("https://example.com/api/v1/auth/login", {
					method: "POST",
					body: "invalid json",
					headers: { "Content-Type": "application/json" },
				}),
				mockEnv,
			);

			expect(response.status).toBe(500);
			const data = await response.json();
			expect(data.error.code).toBe("INTERNAL_ERROR");
		});

		it("should return 401 when PBKDF2 password does not match", async () => {
			const storedHash = await hashPassword("correct_password");

			const user = {
				id: 1,
				username: "testuser",
				password_hash: storedHash,
				password_salt: "",
				role: 0,
				status: 0,
			};

			const { db } = createMockDb({ firstResult: user });
			const env = { ...mockEnv, DB: db };

			const response = await login(
				createLoginRequest({ username: "testuser", password: "wrong_password" }),
				env,
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("should successfully login with PBKDF2 password", async () => {
			const password = "correct_password";
			const storedHash = await hashPassword(password);

			const user = {
				id: 42,
				username: "testuser",
				password_hash: storedHash,
				password_salt: "", // empty = new PBKDF2 format
				role: 0,
				status: 0,
			};

			// Need a DB that returns the user on SELECT, and supports UPDATE for last_login
			const runSpy = mock(() => Promise.resolve({ success: true }));
			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const prepareSpy = mock((_sql: string) => ({
				bind: bindSpy,
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
			const kvPutSpy = mock(() => Promise.resolve());
			const env = {
				...mockEnv,
				DB: db,
				KV: { put: kvPutSpy } as unknown as KVNamespace,
			};

			const response = await login(createLoginRequest({ username: "testuser", password }), env);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify response structure
			expect(data.data.token).toBeDefined();
			expect(typeof data.data.token).toBe("string");
			expect(data.data.refreshToken).toBeDefined();
			expect(typeof data.data.refreshToken).toBe("string");
			expect(data.data.user).toEqual({
				userId: 42,
				username: "testuser",
				role: 0,
			});
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();

			// Verify KV put was called for refresh token
			expect(kvPutSpy).toHaveBeenCalled();

			// Verify last_login update was called (2nd prepare call)
			// First call is SELECT, second is UPDATE last_login
			expect(prepareSpy).toHaveBeenCalledTimes(2);
		});

		it("should successfully login with Discuz password and trigger silent upgrade", async () => {
			// Pre-computed: md5(md5("password123")) + "abcdef"
			// md5("password123") = "482c811da5d5b4bc6d497ffa98491e38"
			// md5("482c811da5d5b4bc6d497ffa98491e38") = "a82a4f1e40e1dcbac1e37d7c5e3a8b27"
			// We need md5("a82a4f1e40e1dcbac1e37d7c5e3a8b27" + "abcdef")
			// Let's compute this using the actual function
			const { MD5 } = await import("crypto-js");
			const firstMd5 = MD5("password123").toString();
			const doubleMd5 = MD5(firstMd5).toString();
			const finalHash = MD5(`${doubleMd5}abcdef`).toString();

			const user = {
				id: 10,
				username: "olduser",
				password_hash: finalHash,
				password_salt: "abcdef", // non-empty = old Discuz format
				role: 1,
				status: 0,
			};

			const runSpy = mock(() => Promise.resolve({ success: true }));
			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const prepareSpy = mock((_sql: string) => ({
				bind: bindSpy,
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
			const kvPutSpy = mock(() => Promise.resolve());
			const env = {
				...mockEnv,
				DB: db,
				KV: { put: kvPutSpy } as unknown as KVNamespace,
			};

			const response = await login(
				createLoginRequest({ username: "olduser", password: "password123" }),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.token).toBeDefined();
			expect(data.data.user.userId).toBe(10);
			expect(data.data.user.role).toBe(1);

			// Should have 3 prepare calls: SELECT, UPDATE password (upgrade), UPDATE last_login
			expect(prepareSpy).toHaveBeenCalledTimes(3);

			// Verify refresh token stored in KV
			expect(kvPutSpy).toHaveBeenCalled();
		});

		it("should return 401 with wrong Discuz password", async () => {
			const user = {
				id: 10,
				username: "olduser",
				password_hash: "wrong_stored_hash",
				password_salt: "abcdef",
				role: 0,
				status: 0,
			};

			const { db } = createMockDb({ firstResult: user });
			const env = { ...mockEnv, DB: db };

			const response = await login(
				createLoginRequest({ username: "olduser", password: "wrong_password" }),
				env,
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("should store refresh token in KV with 30-day TTL", async () => {
			const password = "mypassword";
			const storedHash = await hashPassword(password);

			const user = {
				id: 5,
				username: "kvuser",
				password_hash: storedHash,
				password_salt: "",
				role: 0,
				status: 0,
			};

			const runSpy = mock(() => Promise.resolve({ success: true }));
			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const db = {
				prepare: mock((_sql: string) => ({ bind: bindSpy })),
			} as unknown as D1Database;

			const kvPutSpy = mock(() => Promise.resolve());
			const env = {
				...mockEnv,
				DB: db,
				KV: { put: kvPutSpy } as unknown as KVNamespace,
			};

			await login(createLoginRequest({ username: "kvuser", password }), env);

			// Verify KV put was called with refresh: prefix and 30-day TTL
			expect(kvPutSpy).toHaveBeenCalledTimes(1);
			const [key, _value, options] = kvPutSpy.mock.calls[0] as [
				string,
				string,
				{ expirationTtl: number },
			];
			expect(key).toMatch(/^refresh:/);
			expect(options.expirationTtl).toBe(30 * 24 * 60 * 60);
		});

		it("should update last_login timestamp on successful login", async () => {
			const password = "mypassword";
			const storedHash = await hashPassword(password);

			const user = {
				id: 7,
				username: "loginuser",
				password_hash: storedHash,
				password_salt: "",
				role: 0,
				status: 0,
			};

			const runSpy = mock(() => Promise.resolve({ success: true }));
			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const prepareSpy = mock((_sql: string) => ({
				bind: bindSpy,
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = {
				...mockEnv,
				DB: db,
				KV: { put: mock(() => Promise.resolve()) } as unknown as KVNamespace,
			};

			await login(createLoginRequest({ username: "loginuser", password }), env);

			// Second prepare call should be the last_login update
			const lastCall = prepareSpy.mock.calls[1] as [string];
			expect(lastCall[0]).toContain("UPDATE users SET last_login");
		});

		it("should generate valid JWT token in response", async () => {
			const password = "jwttest";
			const storedHash = await hashPassword(password);

			const user = {
				id: 99,
				username: "jwtuser",
				password_hash: storedHash,
				password_salt: "",
				role: 2,
				status: 0,
			};

			const runSpy = mock(() => Promise.resolve({ success: true }));
			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const db = {
				prepare: mock((_sql: string) => ({ bind: bindSpy })),
			} as unknown as D1Database;

			const env = {
				...mockEnv,
				DB: db,
				KV: { put: mock(() => Promise.resolve()) } as unknown as KVNamespace,
			};

			const response = await login(createLoginRequest({ username: "jwtuser", password }), env);

			const data = await response.json();
			const token = data.data.token as string;

			// JWT should have 3 parts separated by dots
			const parts = token.split(".");
			expect(parts).toHaveLength(3);

			// Decode payload and check fields
			const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
			const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
			const payload = JSON.parse(atob(padded));
			expect(payload.userId).toBe(99);
			expect(payload.role).toBe(2);
			expect(payload.exp).toBeDefined();
			expect(payload.iat).toBeDefined();
		});

		it("should include correct CORS headers on successful login", async () => {
			const password = "corstest";
			const storedHash = await hashPassword(password);

			const user = {
				id: 1,
				username: "corsuser",
				password_hash: storedHash,
				password_salt: "",
				role: 0,
				status: 0,
			};

			const runSpy = mock(() => Promise.resolve({ success: true }));
			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const db = {
				prepare: mock((_sql: string) => ({ bind: bindSpy })),
			} as unknown as D1Database;

			const env = {
				...mockEnv,
				DB: db,
				KV: { put: mock(() => Promise.resolve()) } as unknown as KVNamespace,
			};

			const response = await login(createLoginRequest({ username: "corsuser", password }), env);

			expect(response.headers.get("Content-Type")).toBe("application/json");
			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		});
	});
});
