import { describe, expect, it, mock } from "bun:test";
import { getById } from "../../../src/handlers/user";
import type { Env } from "../../../src/lib/env";

describe("user handlers", () => {
	const mockEnv: Env = {
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
		RATE_LIMITER: {} as DurableObjectNamespace,
	};

	describe("getById", () => {
		it("should return user when found", async () => {
			const user = { id: 123, username: "testuser" };

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

			const response = await getById(new Request("https://example.com/api/v1/users/123"), env);

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.data).toEqual(user);
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});

		it("should return 404 when user not found", async () => {
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

			const response = await getById(new Request("https://example.com/api/v1/users/999"), env);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
		});

		it("should parse user ID from URL", async () => {
			const firstSpy = mock(() => Promise.resolve({ id: 456 }));

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

			await getById(new Request("https://example.com/api/v1/users/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});

		it("should handle non-numeric ID gracefully", async () => {
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

			const response = await getById(new Request("https://example.com/api/v1/users/abc"), env);

			// NaN should result in not found
			expect(response.status).toBe(404);
		});
	});
});
