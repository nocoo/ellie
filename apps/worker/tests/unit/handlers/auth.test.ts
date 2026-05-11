import { describe, expect, it, vi } from "vitest";
import { login, logout, me, refresh } from "../../../src/handlers/auth";
import type { Env } from "../../../src/lib/env";
import { hashPassword } from "../../../src/lib/password";
import { createJwtForRole, makeD1UserRow } from "../../helpers";

// Helper to create a mock D1 database
function createMockDb(
	overrides: {
		firstResult?: unknown;
		runResult?: { success: boolean };
	} = {},
) {
	const runSpy = vi.fn(() => Promise.resolve(overrides.runResult ?? { success: true }));
	const firstSpy = vi.fn(() => Promise.resolve(overrides.firstResult ?? null));

	const bindSpy = vi.fn((..._args: unknown[]) => ({
		first: firstSpy,
		run: runSpy,
	}));

	const prepareSpy = vi.fn((_sql: string) => ({
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
		headers: { "Content-Type": "application/json", "CF-Connecting-IP": "127.0.0.1" },
	});
}

describe("auth handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret-key-for-jwt-hs256",
		KV: {
			get: vi.fn(() => Promise.resolve(null)), // No rate limit hit / no lockout
			put: vi.fn(() => Promise.resolve()),
			delete: vi.fn(() => Promise.resolve()),
		} as unknown as KVNamespace,
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

		it("should return 429 when IP is locked out for 24 hours", async () => {
			const { db } = createMockDb({ firstResult: null });
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn((key: string) => {
						// Simulate IP lockout
						if (key.startsWith("login-lockout-ip:")) return Promise.resolve("1");
						return Promise.resolve(null);
					}),
					put: vi.fn(() => Promise.resolve()),
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
			};

			const response = await login(
				createLoginRequest({ username: "testuser", password: "pass" }),
				env,
			);

			expect(response.status).toBe(429);
			const data = await response.json();
			expect(data.error.code).toBe("RATE_LIMITED");
		});

		it("should return 429 and trigger 24h lockout after 5 failed attempts", async () => {
			const kvPutSpy = vi.fn(() => Promise.resolve());
			const { db } = createMockDb({ firstResult: null });
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn((key: string) => {
						// No lockout yet, but 5 attempts reached
						if (key.startsWith("login-lockout-")) return Promise.resolve(null);
						if (key.startsWith("login-ip:")) {
							return Promise.resolve("5"); // 5 attempts already
						}
						return Promise.resolve(null);
					}),
					put: kvPutSpy,
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
			};

			const response = await login(
				createLoginRequest({ username: "testuser", password: "wrong" }),
				env,
			);

			expect(response.status).toBe(429);
			const data = await response.json();
			expect(data.error.code).toBe("RATE_LIMITED");
			expect(data.error.details?.message).toContain("24 hours");

			// Verify lockout key was set with 24h TTL (IP only, no user lockout)
			const lockoutCalls = kvPutSpy.mock.calls.filter((call) =>
				(call as string[])[0]?.startsWith("login-lockout-"),
			);
			expect(lockoutCalls.length).toBe(1); // IP lockout only
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
			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));

			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const prepareSpy = vi.fn((_sql: string) => ({
				bind: bindSpy,
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
			const kvPutSpy = vi.fn(() => Promise.resolve());
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: kvPutSpy,
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
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
			// Pre-computed: md5(md5("password123") + "abcdef")
			// md5("password123") = "482c811da5d5b4bc6d497ffa98491e38"
			// md5("482c811da5d5b4bc6d497ffa98491e38" + "abcdef") = "4647298d7796457723792f5cde82e0c8"
			const { MD5 } = await import("crypto-js");
			const innerMd5 = MD5("password123").toString();
			const finalHash = MD5(`${innerMd5}abcdef`).toString();

			const user = {
				id: 10,
				username: "olduser",
				password_hash: finalHash,
				password_salt: "abcdef", // non-empty = old Discuz format
				role: 1,
				status: 0,
			};

			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));

			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const prepareSpy = vi.fn((_sql: string) => ({
				bind: bindSpy,
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
			const kvPutSpy = vi.fn(() => Promise.resolve());
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: kvPutSpy,
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
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

			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));

			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const db = {
				prepare: vi.fn((_sql: string) => ({ bind: bindSpy })),
			} as unknown as D1Database;

			const kvPutSpy = vi.fn(() => Promise.resolve());
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: kvPutSpy,
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
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

			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));

			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const prepareSpy = vi.fn((_sql: string) => ({
				bind: bindSpy,
			}));

			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: vi.fn(() => Promise.resolve()),
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
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

			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));

			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const db = {
				prepare: vi.fn((_sql: string) => ({ bind: bindSpy })),
			} as unknown as D1Database;

			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: vi.fn(() => Promise.resolve()),
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
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

			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));

			const bindSpy = vi.fn((..._args: unknown[]) => ({
				first: firstSpy,
				run: runSpy,
			}));

			const db = {
				prepare: vi.fn((_sql: string) => ({ bind: bindSpy })),
			} as unknown as D1Database;

			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: vi.fn(() => Promise.resolve()),
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
			};

			const response = await login(createLoginRequest({ username: "corsuser", password }), env);

			expect(response.headers.get("Content-Type")).toBe("application/json");
			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		});
	});

	/**
	 * Security regression tests — simulate the full register→login flow.
	 *
	 * These tests prove that a newly-registered user CANNOT login with a wrong
	 * password. They use the same `hashPassword` call that `register()` uses and
	 * then attempt login with a different password.
	 *
	 * Context: Task #18 (P0 security report) — "新用户注册后第一次登陆，输入任意
	 * 密码均可登录". These tests prove the Worker password verification is correct.
	 */
	describe("login — register→login password integrity", () => {
		it("rejects wrong password for newly-registered PBKDF2 user", async () => {
			// Simulate what register() stores: hashPassword("original") → password_hash, password_salt=""
			const registrationPassword = "my_secure_pass_123";
			const storedHash = await hashPassword(registrationPassword);

			const user = {
				id: 100,
				username: "newuser",
				password_hash: storedHash,
				password_salt: "", // empty = new PBKDF2 format (as register sets it)
				role: 0,
				status: 0,
			};

			const { db } = createMockDb({ firstResult: user });
			const env = { ...mockEnv, DB: db };

			// Attempt login with DIFFERENT password — must fail
			const response = await login(
				createLoginRequest({ username: "newuser", password: "totally_wrong_password" }),
				env,
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("accepts correct password for newly-registered PBKDF2 user", async () => {
			const registrationPassword = "my_secure_pass_123";
			const storedHash = await hashPassword(registrationPassword);

			const user = {
				id: 100,
				username: "newuser",
				password_hash: storedHash,
				password_salt: "",
				role: 0,
				status: 0,
			};

			const runSpy = vi.fn(() => Promise.resolve({ success: true }));
			const firstSpy = vi.fn(() => Promise.resolve(user));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ first: firstSpy, run: runSpy }));
			const db = { prepare: vi.fn((_sql: string) => ({ bind: bindSpy })) } as unknown as D1Database;
			const env = {
				...mockEnv,
				DB: db,
				KV: {
					get: vi.fn(() => Promise.resolve(null)),
					put: vi.fn(() => Promise.resolve()),
					delete: vi.fn(() => Promise.resolve()),
				} as unknown as KVNamespace,
			};

			// Login with SAME password — must succeed
			const response = await login(
				createLoginRequest({ username: "newuser", password: registrationPassword }),
				env,
			);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data.user.userId).toBe(100);
		});

		it("rejects empty password string", async () => {
			const response = await login(
				createLoginRequest({ username: "newuser", password: "" }),
				mockEnv,
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("rejects login when password_hash is empty (corrupt DB state)", async () => {
			// Edge case: what if password_hash is somehow empty in DB?
			const user = {
				id: 100,
				username: "newuser",
				password_hash: "", // corrupt / empty
				password_salt: "",
				role: 0,
				status: 0,
			};

			const { db } = createMockDb({ firstResult: user });
			const env = { ...mockEnv, DB: db };

			const response = await login(
				createLoginRequest({ username: "newuser", password: "any_password" }),
				env,
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});

		it("rejects login when password_hash has invalid format (no dot separator)", async () => {
			// Edge case: malformed hash without the "salt.hash" format
			const user = {
				id: 100,
				username: "newuser",
				password_hash: "not_a_valid_pbkdf2_hash",
				password_salt: "",
				role: 0,
				status: 0,
			};

			const { db } = createMockDb({ firstResult: user });
			const env = { ...mockEnv, DB: db };

			const response = await login(
				createLoginRequest({ username: "newuser", password: "any_password" }),
				env,
			);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_CREDENTIALS");
		});
	});

	describe("refresh", () => {
		const refreshEnv = (
			kvStore: Map<string, string>,
			dbUser: { id: number; username: string; role: number; status: number } | null,
		): Env => {
			const firstSpy = vi.fn(() => Promise.resolve(dbUser));
			const bindSpy = vi.fn((..._args: unknown[]) => ({ first: firstSpy }));
			const prepareSpy = vi.fn((_sql: string) => ({ bind: bindSpy }));

			return {
				...mockEnv,
				DB: { prepare: prepareSpy } as unknown as D1Database,
				KV: {
					get: vi.fn((key: string) => Promise.resolve(kvStore.get(key) ?? null)),
					put: vi.fn((key: string, value: string) => {
						kvStore.set(key, value);
						return Promise.resolve();
					}),
					delete: vi.fn((key: string) => {
						kvStore.delete(key);
						return Promise.resolve();
					}),
				} as unknown as KVNamespace,
			};
		};

		const createRefreshRequest = (body: Record<string, unknown>) =>
			new Request("https://example.com/api/v1/auth/refresh", {
				method: "POST",
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
			});

		it("should require refreshToken in body", async () => {
			const kvStore = new Map<string, string>();
			const env = refreshEnv(kvStore, { id: 1, username: "test", role: 0, status: 0 });

			const response = await refresh(createRefreshRequest({}), env);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
			expect(body.error.details.message).toBe("refreshToken is required");
		});

		it("should return 401 for invalid refresh token", async () => {
			const kvStore = new Map<string, string>();
			const env = refreshEnv(kvStore, { id: 1, username: "test", role: 0, status: 0 });

			const response = await refresh(createRefreshRequest({ refreshToken: "invalid-token" }), env);

			expect(response.status).toBe(401);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REFRESH_TOKEN");
		});

		it("should return 401 for deleted user (and clean up token)", async () => {
			const kvStore = new Map<string, string>([["refresh:valid-token", "123"]]);
			const env = refreshEnv(kvStore, null);

			const response = await refresh(createRefreshRequest({ refreshToken: "valid-token" }), env);

			expect(response.status).toBe(401);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REFRESH_TOKEN");
			expect(kvStore.get("refresh:valid-token")).toBeUndefined();
		});

		it("should return 403 for banned user (and clean up token)", async () => {
			const kvStore = new Map<string, string>([["refresh:valid-token", "123"]]);
			const env = refreshEnv(kvStore, { id: 123, username: "banned", role: 0, status: -1 });

			const response = await refresh(createRefreshRequest({ refreshToken: "valid-token" }), env);

			expect(response.status).toBe(403);
			const body = await response.json();
			expect(body.error.code).toBe("USER_BANNED");
			expect(kvStore.get("refresh:valid-token")).toBeUndefined();
		});

		it("should issue new JWT and rotated refresh token", async () => {
			const kvStore = new Map<string, string>([["refresh:old-token", "42"]]);
			const env = refreshEnv(kvStore, { id: 42, username: "testuser", role: 1, status: 0 });

			const response = await refresh(createRefreshRequest({ refreshToken: "old-token" }), env);

			expect(response.status).toBe(200);
			const body = await response.json();

			expect(body.data.token).toBeDefined();
			expect(typeof body.data.token).toBe("string");
			expect(body.data.refreshToken).toBeDefined();
			expect(typeof body.data.refreshToken).toBe("string");
			expect(body.data.refreshToken).not.toBe("old-token");
			expect(body.data.user).toEqual({
				userId: 42,
				username: "testuser",
				role: 1,
			});

			// Old token deleted, new token stored
			expect(kvStore.get("refresh:old-token")).toBeUndefined();
			expect(kvStore.has(`refresh:${body.data.refreshToken}`)).toBe(true);
		});

		it("should handle malformed JSON", async () => {
			const kvStore = new Map<string, string>();
			const env = refreshEnv(kvStore, null);

			const response = await refresh(
				new Request("https://example.com/api/v1/auth/refresh", {
					method: "POST",
					body: "invalid json",
					headers: { "Content-Type": "application/json" },
				}),
				env,
			);

			expect(response.status).toBe(500);
			const body = await response.json();
			expect(body.error.code).toBe("INTERNAL_ERROR");
		});

		it("should reject empty string refreshToken", async () => {
			const kvStore = new Map<string, string>();
			const env = refreshEnv(kvStore, null);

			const response = await refresh(createRefreshRequest({ refreshToken: "" }), env);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
		});

		it("should reject non-string refreshToken", async () => {
			const kvStore = new Map<string, string>();
			const env = refreshEnv(kvStore, null);

			const response = await refresh(createRefreshRequest({ refreshToken: 12345 }), env);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
		});

		it("should include CORS headers on success", async () => {
			const kvStore = new Map<string, string>([["refresh:token-x", "1"]]);
			const env = refreshEnv(kvStore, { id: 1, username: "corsuser", role: 0, status: 0 });

			const response = await refresh(createRefreshRequest({ refreshToken: "token-x" }), env);

			expect(response.status).toBe(200);
			expect(response.headers.get("Content-Type")).toBe("application/json");
			expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
				"GET, POST, PATCH, DELETE, OPTIONS",
			);
		});

		it("should include meta fields in successful response", async () => {
			const kvStore = new Map<string, string>([["refresh:token-m", "5"]]);
			const env = refreshEnv(kvStore, { id: 5, username: "metauser", role: 0, status: 0 });

			const response = await refresh(createRefreshRequest({ refreshToken: "token-m" }), env);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.meta.timestamp).toBeDefined();
			expect(typeof body.meta.timestamp).toBe("number");
			expect(body.meta.requestId).toBeDefined();
			expect(typeof body.meta.requestId).toBe("string");
		});

		it("should generate a valid JWT in refresh response", async () => {
			const kvStore = new Map<string, string>([["refresh:token-j", "10"]]);
			const env = refreshEnv(kvStore, { id: 10, username: "jwtrefresh", role: 1, status: 0 });

			const response = await refresh(createRefreshRequest({ refreshToken: "token-j" }), env);

			expect(response.status).toBe(200);
			const body = await response.json();
			const token = body.data.token as string;

			// JWT should have 3 parts
			const parts = token.split(".");
			expect(parts).toHaveLength(3);

			// Decode and verify payload
			const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
			const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4);
			const payload = JSON.parse(atob(padded));
			expect(payload.userId).toBe(10);
			expect(payload.role).toBe(1);
			expect(payload.exp).toBeDefined();
		});
	});

	describe("logout", () => {
		const createLogoutRequest = (body: Record<string, unknown>) =>
			new Request("https://example.com/api/v1/auth/logout", {
				method: "DELETE",
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
			});

		it("should require refreshToken in body", async () => {
			const kvStore = new Map<string, string>();
			const env: Env = {
				...mockEnv,
				KV: {
					delete: vi.fn((key: string) => {
						kvStore.delete(key);
						return Promise.resolve();
					}),
				} as unknown as KVNamespace,
			};

			const response = await logout(createLogoutRequest({}), env);

			expect(response.status).toBe(400);
			const body = await response.json();
			expect(body.error.code).toBe("INVALID_REQUEST");
		});

		it("should delete refresh token from KV", async () => {
			const kvStore = new Map<string, string>([["refresh:my-token", "123"]]);
			const env: Env = {
				...mockEnv,
				KV: {
					delete: vi.fn((key: string) => {
						kvStore.delete(key);
						return Promise.resolve();
					}),
				} as unknown as KVNamespace,
			};

			const response = await logout(createLogoutRequest({ refreshToken: "my-token" }), env);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.loggedOut).toBe(true);
			expect(kvStore.get("refresh:my-token")).toBeUndefined();
		});

		it("should succeed even if token doesn't exist (idempotent)", async () => {
			const env: Env = {
				...mockEnv,
				KV: { delete: vi.fn(() => Promise.resolve()) } as unknown as KVNamespace,
			};

			const response = await logout(createLogoutRequest({ refreshToken: "non-existent" }), env);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.loggedOut).toBe(true);
		});
	});

	describe("me", () => {
		it("should return current user profile", async () => {
			const userRow = makeD1UserRow({ id: 42, username: "meuser", role: 1 });
			const { db } = createMockDb({ firstResult: userRow });

			const token = await createJwtForRole(1, 42);
			const env = { ...mockEnv, DB: db };

			const response = await me(
				new Request("https://example.com/api/v1/auth/me", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				env,
			);

			expect(response.status).toBe(200);
			const body = await response.json();
			expect(body.data.id).toBe(42);
			expect(body.data.username).toBe("meuser");
			expect(body.data.role).toBe(1);
		});

		it("should require authentication", async () => {
			const { db } = createMockDb();
			const env = { ...mockEnv, DB: db };

			const response = await me(new Request("https://example.com/api/v1/auth/me"), env);

			expect(response.status).toBe(401);
		});

		it("should return 404 for non-existent user", async () => {
			const { db } = createMockDb({ firstResult: null });

			const token = await createJwtForRole(1, 999);
			const env = { ...mockEnv, DB: db };

			const response = await me(
				new Request("https://example.com/api/v1/auth/me", {
					headers: { Authorization: `Bearer ${token}` },
				}),
				env,
			);

			expect(response.status).toBe(404);
			const body = await response.json();
			expect(body.error.code).toBe("USER_NOT_FOUND");
		});
	});
});
