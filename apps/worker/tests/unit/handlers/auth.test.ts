import { describe, expect, it, mock } from "bun:test";
import { login } from "../../../src/handlers/auth";
import type { Env } from "../../../src/lib/env";

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
			const response = await login(
				new Request("https://example.com/api/v1/auth/login", {
					method: "POST",
					body: JSON.stringify({ username: "test" }),
					headers: { "Content-Type": "application/json" },
				}),
				mockEnv,
			);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data.error.code).toBe("INVALID_REQUEST");
		});

		it("should return 401 for invalid credentials", async () => {
			const firstSpy = mock(() => Promise.resolve(null));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const response = await login(
				new Request("https://example.com/api/v1/auth/login", {
					method: "POST",
					body: JSON.stringify({ username: "test", password: "wrong" }),
					headers: { "Content-Type": "application/json" },
				}),
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

			const firstSpy = mock(() => Promise.resolve(user));

			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));

			const prepareSpy = mock(() => ({
				bind: bindSpy,
			}));

			const db = {
				prepare: prepareSpy,
			} as unknown as D1Database;

			const env = { ...mockEnv, DB: db };

			const response = await login(
				new Request("https://example.com/api/v1/auth/login", {
					method: "POST",
					body: JSON.stringify({ username: "banned", password: "pass" }),
					headers: { "Content-Type": "application/json" },
				}),
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
	});
});
