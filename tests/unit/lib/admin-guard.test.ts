import { describe, expect, test } from "bun:test";
import { canAdminManageUsers, resolveAdminFromSession } from "@/lib/admin-guard";

describe("admin-guard", () => {
	describe("resolveAdminFromSession", () => {
		test("returns user for admin role", () => {
			const user = resolveAdminFromSession({
				user: { id: "1", name: "admin", role: "admin" },
			});
			expect(user).not.toBeNull();
			expect(user!.username).toBe("admin");
		});

		test("returns user for supermod role", () => {
			const user = resolveAdminFromSession({
				user: { id: "2", name: "supermod", role: "supermod" },
			});
			expect(user).not.toBeNull();
		});

		test("returns null for mod role (no admin access)", () => {
			const user = resolveAdminFromSession({
				user: { id: "3", name: "mod", role: "mod" },
			});
			expect(user).toBeNull();
		});

		test("returns null for user role", () => {
			const user = resolveAdminFromSession({
				user: { id: "4", name: "user", role: "user" },
			});
			expect(user).toBeNull();
		});

		test("returns null for null session", () => {
			expect(resolveAdminFromSession(null)).toBeNull();
		});

		test("returns null for missing user in session", () => {
			expect(resolveAdminFromSession({})).toBeNull();
		});

		test("returns null for missing id", () => {
			expect(resolveAdminFromSession({ user: { name: "admin", role: "admin" } })).toBeNull();
		});

		test("returns null for missing role", () => {
			expect(resolveAdminFromSession({ user: { id: "1", name: "admin" } })).toBeNull();
		});

		test("returns null for unknown role", () => {
			const user = resolveAdminFromSession({
				user: { id: "1", name: "test", role: "unknown" },
			});
			expect(user).toBeNull();
		});
	});

	describe("canAdminManageUsers", () => {
		test("admin can manage users", () => {
			const user = resolveAdminFromSession({
				user: { id: "1", name: "admin", role: "admin" },
			});
			expect(canAdminManageUsers(user)).toBe(true);
		});

		test("supermod cannot manage users", () => {
			const user = resolveAdminFromSession({
				user: { id: "2", name: "supermod", role: "supermod" },
			});
			expect(canAdminManageUsers(user)).toBe(false);
		});

		test("null user cannot manage users", () => {
			expect(canAdminManageUsers(null)).toBe(false);
		});
	});
});
