import { describe, expect, it, mock } from "bun:test";
import { UserRole } from "@ellie/types";
import { withAdmin, withAuth, withModerator } from "../../../src/lib/routeHelpers";
import type { AuthUser } from "../../../src/middleware/auth";
import { createJwtForRole, makeEnv } from "../../helpers";

describe("withAuth", () => {
	const env = makeEnv();

	it("should return 401 when no Authorization header", async () => {
		const handler = mock(
			async (_req: Request, _env: unknown, _user: AuthUser) => new Response("ok"),
		);
		const wrapped = withAuth(handler);
		const req = new Request("https://example.com/api/test");
		const res = await wrapped(req, env);

		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 401 for invalid token", async () => {
		const handler = mock(
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
	const env = makeEnv();

	it("should return 401 when no token", async () => {
		const handler = mock(async () => new Response("ok"));
		const wrapped = withAdmin(handler);
		const req = new Request("https://example.com/api/admin/test");
		const res = await wrapped(req, env);

		expect(res.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("should return 403 for regular user", async () => {
		const handler = mock(async () => new Response("ok"));
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
		const handler = mock(async () => new Response("ok"));
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
		const handler = mock(async () => new Response("ok"));
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
		const handler = mock(async () => new Response("ok"));
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
});

describe("withModerator", () => {
	const env = makeEnv();

	it("should return 403 for regular user", async () => {
		const handler = mock(async () => new Response("ok"));
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
		const handler = mock(async () => new Response("ok"));
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
		const handler = mock(async () => new Response("ok"));
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
		const handler = mock(async () => new Response("ok"));
		const wrapped = withModerator(handler);
		const token = await createJwtForRole(UserRole.Admin);
		const req = new Request("https://example.com/api/admin/test", {
			headers: { Authorization: `Bearer ${token}` },
		});
		const res = await wrapped(req, env);

		expect(res.status).toBe(200);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
