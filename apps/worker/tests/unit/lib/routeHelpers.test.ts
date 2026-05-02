import { EMAIL_NOT_VERIFIED_PAYLOAD, UserRole } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import {
	withAdmin,
	withAuth,
	withModerator,
	withVerifiedEmail,
} from "../../../src/lib/routeHelpers";
import type { AuthUser } from "../../../src/middleware/auth";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";

describe("withAuth", () => {
	const env = makeEnv();

	it("should return 401 when no Authorization header", async () => {
		const handler = vi.fn(
			async (_req: Request, _env: unknown, _user: AuthUser) => new Response("ok"),
		);
		const wrapped = withAuth(handler);
		const req = new Request("https://example.com/api/test");
		const res = await wrapped(req, env);

		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 401 for invalid token", async () => {
		const handler = vi.fn(
			async (_req: Request, _env: unknown, _user: AuthUser) => new Response("ok"),
		);
		const wrapped = withAuth(handler);
		const req = new Request("https://example.com/api/test", {
			headers: { Authorization: "Bearer invalid" },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should pass AuthUser to handler for valid token", async () => {
		let capturedUser: AuthUser | null = null;
		const handler = async (_req: Request, _env: unknown, user: AuthUser) => {
			capturedUser = user;
			return new Response("ok");
		};
		const wrapped = withAuth(handler);
		const token = await createJwtForRole(UserRole.User, 42);
		const req = new Request("https://example.com/api/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(capturedUser).not.toBeNull();
		expect(capturedUser?.userId).toBe(42);
		expect(capturedUser?.role).toBe(UserRole.User);
	});
});

describe("withAdmin", () => {
	/** Create env with mock DB returning specified user */
	function makeEnvWithDb(dbUser: { role: number; status: number } | null) {
		const { db } = createMockDb({
			firstResults: { "SELECT role, status FROM users": dbUser },
		});
		return makeEnv({ DB: db });
	}

	it("should return 401 when no token", async () => {
		const env = makeEnvWithDb({ role: 1, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const req = new Request("https://example.com/api/admin/test");
		const res = await wrapped(req, env);

		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 403 for regular user", async () => {
		const env = makeEnvWithDb({ role: UserRole.User, status: 0 }); // DB returns User role
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.User);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe("FORBIDDEN_ADMIN_ONLY");
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 403 for Mod", async () => {
		const env = makeEnvWithDb({ role: UserRole.Mod, status: 0 }); // DB returns Mod role
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.Mod);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should call handler for Admin", async () => {
		const env = makeEnvWithDb({ role: UserRole.Admin, status: 0 }); // DB returns Admin role
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.Admin);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should include CORS headers on 403 when origin is provided", async () => {
		const env = makeEnvWithDb({ role: UserRole.User, status: 0 }); // DB returns User role
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.User);
		const req = new Request("https://example.com/api/admin/test", {
			headers: {
				Authorization: `Bearer ${token}`,
				Origin: "https://ellie.nocoo.cloud",
			},
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
	});

	it("should return 404 when user not found in DB", async () => {
		const env = makeEnvWithDb(null); // DB returns null
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.Admin);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(404);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 403 when user is banned", async () => {
		const env = makeEnvWithDb({ role: UserRole.Admin, status: 1 }); // Banned user
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.Admin);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should use DB role instead of JWT role (prevents privilege escalation)", async () => {
		// JWT claims Admin, but DB says User
		const env = makeEnvWithDb({ role: UserRole.User, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const token = await createJwtForRole(UserRole.Admin); // JWT says Admin
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403); // Should be denied based on DB role
		expect(handler).not.toHaveBeenCalled();
	});
});

describe("withModerator", () => {
	/** Create env with mock DB returning specified user */
	function makeEnvWithDb(dbUser: { role: number; status: number } | null) {
		const { db } = createMockDb({
			firstResults: { "SELECT role, status FROM users": dbUser },
		});
		return makeEnv({ DB: db });
	}

	it("should return 403 for regular user", async () => {
		const env = makeEnvWithDb({ role: UserRole.User, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withModerator(handler);
		const token = await createJwtForRole(UserRole.User);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe("FORBIDDEN_MOD_ONLY");
	});

	it("should call handler for Mod", async () => {
		const env = makeEnvWithDb({ role: UserRole.Mod, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withModerator(handler);
		const token = await createJwtForRole(UserRole.Mod);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should call handler for SuperMod", async () => {
		const env = makeEnvWithDb({ role: UserRole.SuperMod, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withModerator(handler);
		const token = await createJwtForRole(UserRole.SuperMod);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should call handler for Admin", async () => {
		const env = makeEnvWithDb({ role: UserRole.Admin, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withModerator(handler);
		const token = await createJwtForRole(UserRole.Admin);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("should use DB role instead of JWT role (prevents privilege escalation)", async () => {
		// JWT claims Mod, but DB says User
		const env = makeEnvWithDb({ role: UserRole.User, status: 0 });
		const handler = vi.fn(async () => new Response("ok"));
		const wrapped = withModerator(handler);
		const token = await createJwtForRole(UserRole.Mod); // JWT says Mod
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(403); // Should be denied based on DB role
		expect(handler).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// withVerifiedEmail (docs/17 §2 — read-only gate wrapper)
// ---------------------------------------------------------------------------

describe("withVerifiedEmail", () => {
	function envWithUser(dbUser: { role: number; status: number; email_verified_at: number } | null) {
		const { db } = createMockDb({
			firstResults: {
				"SELECT role, status, email_verified_at FROM users": dbUser,
			},
		});
		return makeEnv({ DB: db });
	}

	it("returns 401 when no Authorization header", async () => {
		const handler = vi.fn(
			async (_req: Request, _env: unknown, _user: AuthUser) => new Response("ok"),
		);
		const wrapped = withVerifiedEmail(handler);
		const res = await wrapped(new Request("https://example.com/api/test"), envWithUser(null));
		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("invokes handler with DB-verified user when email is verified", async () => {
		let captured: AuthUser | null = null;
		const handler = async (_req: Request, _env: unknown, user: AuthUser) => {
			captured = user;
			return new Response("ok");
		};
		const env = envWithUser({ role: 2, status: 0, email_verified_at: 1700000000 });
		const token = await createJwtForRole(UserRole.User, 5);
		const res = await wrappedRequest(token, withVerifiedEmail(handler), env);
		expect(res.status).toBe(200);
		expect(captured).not.toBeNull();
		expect((captured as unknown as AuthUser).userId).toBe(5);
		expect((captured as unknown as AuthUser).role).toBe(2); // DB role wins
	});

	it("returns 403 EMAIL_NOT_VERIFIED when email is unverified", async () => {
		const handler = vi.fn(
			async (_req: Request, _env: unknown, _user: AuthUser) => new Response("ok"),
		);
		const env = envWithUser({ role: 0, status: 0, email_verified_at: 0 });
		const token = await createJwtForRole(UserRole.User, 5);
		const res = await wrappedRequest(token, withVerifiedEmail(handler), env);
		expect(res.status).toBe(403);
		const data = await res.json();
		// docs/17 §5.4 — flat payload shape, not the wrapped { error: { code } }.
		expect(data).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns 403 USER_BANNED before EMAIL_NOT_VERIFIED (banned + unverified)", async () => {
		const handler = vi.fn(
			async (_req: Request, _env: unknown, _user: AuthUser) => new Response("ok"),
		);
		const env = envWithUser({ role: 0, status: -1, email_verified_at: 0 });
		const token = await createJwtForRole(UserRole.User, 5);
		const res = await wrappedRequest(token, withVerifiedEmail(handler), env);
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.code).toBe("USER_BANNED"); // precedence rule
		expect(handler).not.toHaveBeenCalled();
	});
});

async function wrappedRequest(
	token: string,
	wrapped: (req: Request, env: unknown) => Promise<Response>,
	env: unknown,
): Promise<Response> {
	const req = new Request("https://example.com/api/test", {
		headers: { Authorization: `Bearer ${token}` },
	});
	return wrapped(req, env);
}
