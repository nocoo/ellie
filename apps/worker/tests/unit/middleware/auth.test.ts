import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/lib/env";
import { createJwt } from "../../../src/lib/jwt";
import {
	authMiddleware,
	authMiddlewareVerified,
	moderationMiddleware,
	optionalAuth,
	optionalAuthVerified,
} from "../../../src/middleware/auth";
import { createMockDb, createMockKV } from "../../helpers";

describe("authMiddleware", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		ADMIN_API_KEY: "test-admin-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret-key-for-jwt-hs256",
		KV: createMockKV(),
	};

	it("should return 401 when Authorization header is missing", async () => {
		const request = new Request("https://example.com/api/v1/threads", {
			headers: {},
		});

		const result = await authMiddleware(request, mockEnv);

		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error.code).toBe("UNAUTHORIZED");
	});

	it("should return 401 when Authorization header doesn't start with Bearer", async () => {
		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: "Basic token123",
			},
		});

		const result = await authMiddleware(request, mockEnv);

		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error.code).toBe("UNAUTHORIZED");
	});

	it("should return 401 when Authorization header is just 'Bearer' with no token", async () => {
		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: "Bearer",
			},
		});

		const result = await authMiddleware(request, mockEnv);

		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
	});

	it("should return 401 for invalid token format", async () => {
		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: "Bearer invalid_token",
			},
		});

		const result = await authMiddleware(request, mockEnv);

		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error.code).toBe("INVALID_TOKEN");
	});

	it("should return 401 for token signed with wrong secret", async () => {
		const token = await createJwt(
			{
				userId: 1,
				role: 0,
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			"wrong-secret-key",
		);

		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		const result = await authMiddleware(request, mockEnv);

		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error.code).toBe("INVALID_TOKEN");
	});

	it("should return 401 for expired token", async () => {
		const token = await createJwt(
			{
				userId: 1,
				role: 0,
				exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
			},
			mockEnv.JWT_SECRET,
		);

		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		const result = await authMiddleware(request, mockEnv);

		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(401);
		const data = await response.json();
		expect(data.error.code).toBe("TOKEN_EXPIRED");
	});

	it("should return user object for valid non-expired token", async () => {
		const token = await createJwt(
			{
				userId: 123,
				role: 2,
				exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
			},
			mockEnv.JWT_SECRET,
		);

		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		const result = await authMiddleware(request, mockEnv);

		// Should NOT be a Response (it should be the user object)
		expect(result).not.toBeInstanceOf(Response);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.userId).toBe(123);
		expect(authResult.user.role).toBe(2);
	});

	it("should extract correct userId and role from token", async () => {
		const token = await createJwt(
			{
				userId: 999,
				role: 1,
				exp: Math.floor(Date.now() / 1000) + 7200,
			},
			mockEnv.JWT_SECRET,
		);

		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		const result = await authMiddleware(request, mockEnv);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.userId).toBe(999);
		expect(authResult.user.role).toBe(1);
	});

	it("should handle token with role 0 (regular user)", async () => {
		const token = await createJwt(
			{
				userId: 50,
				role: 0,
				exp: Math.floor(Date.now() / 1000) + 3600,
			},
			mockEnv.JWT_SECRET,
		);

		const request = new Request("https://example.com/api/v1/threads", {
			headers: {
				Authorization: `Bearer ${token}`,
			},
		});

		const result = await authMiddleware(request, mockEnv);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.userId).toBe(50);
		expect(authResult.user.role).toBe(0);
	});
});

describe("moderationMiddleware", () => {
	/** Create a mock env with DB that returns specified user role/status */
	function createModMockEnv(dbUser: { role: number; status: number } | null): Env {
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": dbUser,
			},
		});
		return {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: db,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret-key-for-jwt-hs256",
			KV: createMockKV(),
		};
	}

	it("should return 401 when no Authorization header", async () => {
		const mockEnv = createModMockEnv({ role: 1, status: 0 });
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky");
		const result = await moderationMiddleware(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	it("should return 403 for regular user (role 0)", async () => {
		const mockEnv = createModMockEnv({ role: 0, status: 0 }); // DB returns role 0
		const token = await createJwt(
			{ userId: 1, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(403);
		const data = await response.json();
		expect(data.error.code).toBe("FORBIDDEN_MOD_ONLY");
	});

	it("should allow Admin (role 1)", async () => {
		const mockEnv = createModMockEnv({ role: 1, status: 0 }); // DB returns role 1
		const token = await createJwt(
			{ userId: 1, role: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).not.toBeInstanceOf(Response);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.role).toBe(1);
	});

	it("should allow SuperMod (role 2)", async () => {
		const mockEnv = createModMockEnv({ role: 2, status: 0 }); // DB returns role 2
		const token = await createJwt(
			{ userId: 2, role: 2, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).not.toBeInstanceOf(Response);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.role).toBe(2);
	});

	it("should allow Mod (role 3)", async () => {
		const mockEnv = createModMockEnv({ role: 3, status: 0 }); // DB returns role 3
		const token = await createJwt(
			{ userId: 3, role: 3, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).not.toBeInstanceOf(Response);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.role).toBe(3);
	});

	it("should return 401 for expired token", async () => {
		const mockEnv = createModMockEnv({ role: 1, status: 0 });
		const token = await createJwt(
			{ userId: 1, role: 1, exp: Math.floor(Date.now() / 1000) - 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	it("should return 404 when user not found in DB", async () => {
		const mockEnv = createModMockEnv(null); // DB returns null
		const token = await createJwt(
			{ userId: 999, role: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(404);
	});

	it("should return 403 when user is banned (status != 0)", async () => {
		const mockEnv = createModMockEnv({ role: 1, status: 1 }); // DB returns banned user
		const token = await createJwt(
			{ userId: 1, role: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(403);
	});

	it("should use DB role instead of JWT role (prevents privilege escalation)", async () => {
		// JWT claims role 1 (Admin), but DB says role 0 (User)
		const mockEnv = createModMockEnv({ role: 0, status: 0 });
		const token = await createJwt(
			{ userId: 1, role: 1, exp: Math.floor(Date.now() / 1000) + 3600 }, // JWT says Admin
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/moderation/threads/1/sticky", {
			headers: { Authorization: `Bearer ${token}` },
		});

		const result = await moderationMiddleware(request, mockEnv);
		expect(result).toBeInstanceOf(Response);
		const response = result as Response;
		expect(response.status).toBe(403); // Should be denied based on DB role
	});
});

// ---------------------------------------------------------------------------
// optionalAuth
// ---------------------------------------------------------------------------

describe("optionalAuth", () => {
	const mockEnv: Env = {
		API_KEY: "test-api-key",
		ADMIN_API_KEY: "test-admin-api-key",
		DB: {} as D1Database,
		ENVIRONMENT: "test",
		JWT_SECRET: "test-secret-key-for-jwt-hs256",
		KV: createMockKV(),
	};

	it("returns null when no Authorization header", async () => {
		const request = new Request("https://example.com/api/v1/threads");
		const result = await optionalAuth(request, mockEnv);
		expect(result).toBeNull();
	});

	it("returns null when Authorization header is not Bearer", async () => {
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: "Basic abc" },
		});
		const result = await optionalAuth(request, mockEnv);
		expect(result).toBeNull();
	});

	it("returns user for valid token", async () => {
		const token = await createJwt(
			{ userId: 42, role: 2, exp: Math.floor(Date.now() / 1000) + 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await optionalAuth(request, mockEnv);
		expect(result).toEqual({ userId: 42, role: 2 });
	});

	it("returns null for expired token", async () => {
		const token = await createJwt(
			{ userId: 1, role: 0, exp: Math.floor(Date.now() / 1000) - 3600 },
			mockEnv.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await optionalAuth(request, mockEnv);
		expect(result).toBeNull();
	});

	it("returns null for invalid token", async () => {
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: "Bearer invalid.token.here" },
		});
		const result = await optionalAuth(request, mockEnv);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// optionalAuthVerified
// ---------------------------------------------------------------------------

describe("optionalAuthVerified", () => {
	function createVerifiedEnv(dbUser: { role: number; status: number } | null): Env {
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": dbUser,
			},
		});
		return {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: db,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret-key-for-jwt-hs256",
			KV: createMockKV(),
		};
	}

	it("returns null when no Authorization header", async () => {
		const env = createVerifiedEnv({ role: 0, status: 0 });
		const request = new Request("https://example.com/api/v1/threads");
		const result = await optionalAuthVerified(request, env);
		expect(result).toBeNull();
	});

	it("returns user with DB-verified role for valid token", async () => {
		const env = createVerifiedEnv({ role: 2, status: 0 });
		const token = await createJwt(
			{ userId: 1, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await optionalAuthVerified(request, env);
		expect(result).toEqual({ userId: 1, role: 2 }); // DB role, not JWT role
	});

	it("returns null for expired token", async () => {
		const env = createVerifiedEnv({ role: 0, status: 0 });
		const token = await createJwt(
			{ userId: 1, role: 0, exp: Math.floor(Date.now() / 1000) - 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await optionalAuthVerified(request, env);
		expect(result).toBeNull();
	});

	it("returns null for user not found in DB", async () => {
		const env = createVerifiedEnv(null);
		const token = await createJwt(
			{ userId: 999, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await optionalAuthVerified(request, env);
		expect(result).toBeNull();
	});

	it("returns null for banned user (status !== 0)", async () => {
		const env = createVerifiedEnv({ role: 1, status: -1 });
		const token = await createJwt(
			{ userId: 1, role: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await optionalAuthVerified(request, env);
		expect(result).toBeNull();
	});

	it("returns null for invalid token", async () => {
		const env = createVerifiedEnv({ role: 0, status: 0 });
		const request = new Request("https://example.com/api/v1/threads", {
			headers: { Authorization: "Bearer bad.token" },
		});
		const result = await optionalAuthVerified(request, env);
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// authMiddlewareVerified
// ---------------------------------------------------------------------------

describe("authMiddlewareVerified", () => {
	function createVerifiedEnv(dbUser: { role: number; status: number } | null): Env {
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status FROM users": dbUser,
			},
		});
		return {
			API_KEY: "test-api-key",
			ADMIN_API_KEY: "test-admin-api-key",
			DB: db,
			ENVIRONMENT: "test",
			JWT_SECRET: "test-secret-key-for-jwt-hs256",
			KV: createMockKV(),
		};
	}

	it("returns 401 when no auth header", async () => {
		const env = createVerifiedEnv({ role: 0, status: 0 });
		const request = new Request("https://example.com/api/v1/me/posts");
		const result = await authMiddlewareVerified(request, env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	it("returns 401 for expired token", async () => {
		const env = createVerifiedEnv({ role: 0, status: 0 });
		const token = await createJwt(
			{ userId: 1, role: 0, exp: Math.floor(Date.now() / 1000) - 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/me/posts", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await authMiddlewareVerified(request, env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	it("returns 404 when user not found in DB", async () => {
		const env = createVerifiedEnv(null);
		const token = await createJwt(
			{ userId: 999, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/me/posts", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await authMiddlewareVerified(request, env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(404);
	});

	it("returns 403 when user is banned", async () => {
		const env = createVerifiedEnv({ role: 1, status: -1 });
		const token = await createJwt(
			{ userId: 1, role: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/me/posts", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await authMiddlewareVerified(request, env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(403);
	});

	it("returns user with DB-verified role for valid token", async () => {
		const env = createVerifiedEnv({ role: 2, status: 0 });
		const token = await createJwt(
			{ userId: 5, role: 0, exp: Math.floor(Date.now() / 1000) + 3600 },
			env.JWT_SECRET,
		);
		const request = new Request("https://example.com/api/v1/me/posts", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const result = await authMiddlewareVerified(request, env);
		expect(result).not.toBeInstanceOf(Response);
		const authResult = result as { user: { userId: number; role: number } };
		expect(authResult.user.userId).toBe(5);
		expect(authResult.user.role).toBe(2); // DB role
	});

	it("returns 401 for invalid token", async () => {
		const env = createVerifiedEnv({ role: 0, status: 0 });
		const request = new Request("https://example.com/api/v1/me/posts", {
			headers: { Authorization: "Bearer invalid.token" },
		});
		const result = await authMiddlewareVerified(request, env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});
});
