import { describe, expect, it, mock } from "bun:test";
import { getById } from "../../../src/handlers/user";
import type { Env } from "../../../src/lib/env";

describe("user handlers", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret",
		KV: {} as KVNamespace,
	};

	/** D1 row (snake_case) as it would come from SELECT with specific columns */
	const makeD1UserRow = (overrides?: Record<string, unknown>) => ({
		id: 123,
		username: "testuser",
		email: "test@example.com",
		avatar: "avatar.png",
		status: 0,
		role: 1,
		reg_date: 1711540800,
		last_login: 1711544400,
		threads: 10,
		posts: 50,
		credits: 100,
		...overrides,
	});

	describe("getById", () => {
		it("should map D1 snake_case row to camelCase User", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/123"), env);

			expect(response.status).toBe(200);
			const data = await response.json();

			// Verify camelCase mapping
			expect(data.data.id).toBe(123);
			expect(data.data.username).toBe("testuser");
			expect(data.data.regDate).toBe(1711540800);
			expect(data.data.lastLogin).toBe(1711544400);
			expect(data.data.threads).toBe(10);
			expect(data.data.posts).toBe(50);
			expect(data.data.credits).toBe(100);

			// No snake_case leaks
			expect(data.data.reg_date).toBeUndefined();
			expect(data.data.last_login).toBeUndefined();

			// Metadata
			expect(data.meta.timestamp).toBeDefined();
			expect(data.meta.requestId).toBeDefined();
		});

		it("should NOT leak password_hash or password_salt", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/123"), env);

			const data = await response.json();
			// Even if D1 somehow returned them, the mapper should strip them
			expect(data.data.password_hash).toBeUndefined();
			expect(data.data.password_salt).toBeUndefined();
			expect(data.data.passwordHash).toBeUndefined();
			expect(data.data.passwordSalt).toBeUndefined();
		});

		it("should SELECT specific columns (not SELECT *)", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/users/123"), env);

			const sql = prepareSpy.mock.calls[0][0] as string;
			// Should NOT use SELECT *
			expect(sql).not.toContain("SELECT *");
			// Should explicitly list columns
			expect(sql).toContain("id");
			expect(sql).toContain("username");
			expect(sql).toContain("email");
			// Should NOT contain password columns
			expect(sql).not.toContain("password_hash");
			expect(sql).not.toContain("password_salt");
		});

		it("should return 404 with CORS headers when user not found", async () => {
			const firstSpy = mock(() => Promise.resolve(null));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/users/999", {
					headers: {
						Origin: "https://ellie.nocoo.cloud",
					},
				}),
				env,
			);

			expect(response.status).toBe(404);
			const data = await response.json();
			expect(data.error.code).toBe("USER_NOT_FOUND");
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
		});

		it("should parse user ID from URL", async () => {
			const d1Row = makeD1UserRow({ id: 456 });
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			await getById(new Request("https://example.com/api/v1/users/456"), env);

			expect(bindSpy).toHaveBeenCalledWith(456);
		});

		it("should handle non-numeric ID gracefully", async () => {
			const firstSpy = mock(() => Promise.resolve(null));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(new Request("https://example.com/api/v1/users/abc"), env);

			// NaN should result in not found
			expect(response.status).toBe(404);
		});

		it("should include CORS headers with valid origin", async () => {
			const d1Row = makeD1UserRow();
			const firstSpy = mock(() => Promise.resolve(d1Row));
			const bindSpy = mock((..._args: unknown[]) => ({
				first: firstSpy,
			}));
			const prepareSpy = mock(() => ({ bind: bindSpy }));
			const db = { prepare: prepareSpy } as unknown as D1Database;
			const env = { ...mockEnv, DB: db };

			const response = await getById(
				new Request("https://example.com/api/v1/users/123", {
					headers: {
						Origin: "http://localhost:3000",
					},
				}),
				env,
			);

			expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
		});
	});
});
