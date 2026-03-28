import { describe, expect, it, mock } from "bun:test";
import { UserRole } from "@ellie/types";
import { adminAuth, createEntityHandlers, withEntityAuth } from "../../../src/lib/adminHelpers";
import type { EntityConfig } from "../../../src/lib/crud";
import type { AuthUser } from "../../../src/middleware/auth";
import { TEST_JWT_SECRET, createJwtForRole, makeEnv } from "../../helpers";

// ─── Fixtures ──────────────────────────────────────────────

const adminConfig: EntityConfig = {
	table: "test",
	entityName: "TEST",
	auth: "admin",
	columns: "*",
	mapper: (r) => r,
};

const modConfig: EntityConfig = {
	table: "test",
	entityName: "TEST",
	auth: "moderator",
	columns: "*",
	mapper: (r) => r,
};

function makeRequest(token?: string): Request {
	const headers: Record<string, string> = {};
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}
	return new Request("https://api.example.com/api/admin/test", { headers });
}

// ─── adminAuth ─────────────────────────────────────────────

describe("adminAuth", () => {
	const env = makeEnv();

	it("should return { user } for a valid JWT", async () => {
		const token = await createJwtForRole(UserRole.Admin);
		const result = await adminAuth(makeRequest(token), env);
		expect(result).not.toBeInstanceOf(Response);
		const { user } = result as { user: AuthUser };
		expect(user.userId).toBe(1);
		expect(user.role).toBe(UserRole.Admin);
	});

	it("should return 401 Response when Authorization header is missing", async () => {
		const result = await adminAuth(makeRequest(), env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	it("should return 401 Response for an invalid JWT", async () => {
		const result = await adminAuth(makeRequest("invalid-token"), env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});

	it("should return 401 Response for an expired JWT", async () => {
		// Create a JWT with an already-expired timestamp
		const { createJwt } = await import("../../../src/lib/jwt");
		const expiredToken = await createJwt(
			{ userId: 1, role: UserRole.Admin, exp: Math.floor(Date.now() / 1000) - 3600 },
			TEST_JWT_SECRET,
		);
		const result = await adminAuth(makeRequest(expiredToken), env);
		expect(result).toBeInstanceOf(Response);
		expect((result as Response).status).toBe(401);
	});
});

// ─── withEntityAuth ────────────────────────────────────────

describe("withEntityAuth", () => {
	const env = makeEnv();

	it("should return 401 when no auth header is present", async () => {
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(adminConfig, handler);
		const res = await wrapped(makeRequest(), env);
		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 401 for an invalid JWT", async () => {
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(adminConfig, handler);
		const res = await wrapped(makeRequest("bad-token"), env);
		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 403 when admin auth is required but user role is User", async () => {
		const token = await createJwtForRole(UserRole.User);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(adminConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("FORBIDDEN_ADMIN_ONLY");
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 403 when admin auth is required but user role is Mod", async () => {
		const token = await createJwtForRole(UserRole.Mod);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(adminConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should call handler when admin auth is required and user is Admin", async () => {
		const token = await createJwtForRole(UserRole.Admin);
		const handler = mock(
			async (_req: Request, _env, user: AuthUser) =>
				new Response(JSON.stringify({ role: user.role })),
		);
		const wrapped = withEntityAuth(adminConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
		const body = (await res.json()) as { role: number };
		expect(body.role).toBe(UserRole.Admin);
	});

	it("should return 403 when moderator auth is required but user role is User", async () => {
		const token = await createJwtForRole(UserRole.User);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(modConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("FORBIDDEN_MOD_ONLY");
		expect(handler).not.toHaveBeenCalled();
	});

	it("should call handler when moderator auth is required and user is Mod", async () => {
		const token = await createJwtForRole(UserRole.Mod);
		const handler = mock(
			async (_req: Request, _env, user: AuthUser) =>
				new Response(JSON.stringify({ role: user.role })),
		);
		const wrapped = withEntityAuth(modConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should call handler when moderator auth is required and user is Admin", async () => {
		const token = await createJwtForRole(UserRole.Admin);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(modConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should call handler when moderator auth is required and user is SuperMod", async () => {
		const token = await createJwtForRole(UserRole.SuperMod);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = withEntityAuth(modConfig, handler);
		const res = await wrapped(makeRequest(token), env);
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

// ─── createEntityHandlers ──────────────────────────────────

describe("createEntityHandlers", () => {
	const env = makeEnv();

	it("should wrap all handlers with entity auth", async () => {
		const listHandler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("list"));
		const getHandler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("get"));

		const wrapped = createEntityHandlers(adminConfig, { list: listHandler, get: getHandler });

		expect(wrapped.list).toBeDefined();
		expect(wrapped.get).toBeDefined();

		// Without auth → 401
		const res = await wrapped.list(makeRequest(), env);
		expect(res.status).toBe(401);
		expect(listHandler).not.toHaveBeenCalled();
	});

	it("should allow authorized access through wrapped handlers", async () => {
		const token = await createJwtForRole(UserRole.Admin);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = createEntityHandlers(adminConfig, { action: handler });

		const res = await wrapped.action(makeRequest(token), env);
		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should apply role checks per entity config", async () => {
		const token = await createJwtForRole(UserRole.User);
		const handler = mock(async (_req: Request, _env, _user: AuthUser) => new Response("ok"));
		const wrapped = createEntityHandlers(modConfig, { action: handler });

		const res = await wrapped.action(makeRequest(token), env);
		expect(res.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});
});
