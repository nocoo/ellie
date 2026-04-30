import { UserRole } from "@ellie/types";
import { describe, expect, it } from "vitest";
import { requireAdmin, requireModerator } from "../../../src/middleware/admin";
import type { AuthUser } from "../../../src/middleware/auth";

describe("requireAdmin", () => {
	it("should return null for Admin role", () => {
		const user: AuthUser = { userId: 1, role: UserRole.Admin };
		expect(requireAdmin(user)).toBeNull();
	});

	it("should return 403 for SuperMod role", async () => {
		const user: AuthUser = { userId: 1, role: UserRole.SuperMod };
		const res = requireAdmin(user);
		expect(res).toBeInstanceOf(Response);
		expect(res?.status).toBe(403);
		const body = await res?.json();
		expect(body.error.code).toBe("FORBIDDEN_ADMIN_ONLY");
	});

	it("should return 403 for Mod role", async () => {
		const user: AuthUser = { userId: 1, role: UserRole.Mod };
		const res = requireAdmin(user);
		expect(res).toBeInstanceOf(Response);
		expect(res?.status).toBe(403);
	});

	it("should return 403 for User role", async () => {
		const user: AuthUser = { userId: 1, role: UserRole.User };
		const res = requireAdmin(user);
		expect(res).toBeInstanceOf(Response);
		expect(res?.status).toBe(403);
	});

	it("should include CORS headers when origin is provided", () => {
		const user: AuthUser = { userId: 1, role: UserRole.User };
		const res = requireAdmin(user, "https://ellie.nocoo.cloud");
		expect(res).toBeInstanceOf(Response);
		expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("https://ellie.nocoo.cloud");
	});
});

describe("requireModerator", () => {
	it("should return null for Admin role", () => {
		const user: AuthUser = { userId: 1, role: UserRole.Admin };
		expect(requireModerator(user)).toBeNull();
	});

	it("should return null for SuperMod role", () => {
		const user: AuthUser = { userId: 1, role: UserRole.SuperMod };
		expect(requireModerator(user)).toBeNull();
	});

	it("should return null for Mod role", () => {
		const user: AuthUser = { userId: 1, role: UserRole.Mod };
		expect(requireModerator(user)).toBeNull();
	});

	it("should return 403 for User role", async () => {
		const user: AuthUser = { userId: 1, role: UserRole.User };
		const res = requireModerator(user);
		expect(res).toBeInstanceOf(Response);
		expect(res?.status).toBe(403);
		const body = await res?.json();
		expect(body.error.code).toBe("FORBIDDEN_MOD_ONLY");
	});

	it("should include CORS headers when origin is provided", () => {
		const user: AuthUser = { userId: 1, role: UserRole.User };
		const res = requireModerator(user, "http://localhost:3000");
		expect(res).toBeInstanceOf(Response);
		expect(res?.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
	});
});
