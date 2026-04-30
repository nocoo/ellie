import { isAdmin, resolveAdmin } from "@/lib/admin";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("admin", () => {
	const originalEnv = process.env.ADMIN_EMAILS;

	beforeEach(() => {
		process.env.ADMIN_EMAILS = "admin@example.com, Boss@Corp.io";
	});

	afterEach(() => {
		process.env.ADMIN_EMAILS = originalEnv;
	});

	describe("isAdmin", () => {
		it("returns true for listed email", () => {
			expect(isAdmin("admin@example.com")).toBe(true);
		});

		it("is case insensitive", () => {
			expect(isAdmin("ADMIN@EXAMPLE.COM")).toBe(true);
			expect(isAdmin("boss@corp.io")).toBe(true);
		});

		it("returns false for unlisted email", () => {
			expect(isAdmin("nobody@example.com")).toBe(false);
		});

		it("returns false for null/undefined/empty", () => {
			expect(isAdmin(null)).toBe(false);
			expect(isAdmin(undefined)).toBe(false);
			expect(isAdmin("")).toBe(false);
		});

		it("returns false when env is empty", () => {
			process.env.ADMIN_EMAILS = "";
			expect(isAdmin("admin@example.com")).toBe(false);
		});
	});

	describe("resolveAdmin", () => {
		it("returns null for null session", () => {
			expect(resolveAdmin(null)).toBeNull();
		});

		it("returns null when session has no user", () => {
			expect(resolveAdmin({ user: undefined })).toBeNull();
			expect(resolveAdmin({})).toBeNull();
		});

		it("returns null when email is not admin", () => {
			const session = { user: { id: "1", email: "nobody@x.com", name: "X" } };
			expect(resolveAdmin(session)).toBeNull();
		});

		it("returns AdminInfo for valid admin session", () => {
			const session = {
				user: { id: "sub1", email: "admin@example.com", name: "Admin", image: "http://img" },
			};
			expect(resolveAdmin(session)).toEqual({
				sub: "sub1",
				email: "admin@example.com",
				name: "Admin",
				image: "http://img",
			});
		});

		it("handles missing optional fields gracefully", () => {
			const session = { user: { email: "admin@example.com" } };
			const result = resolveAdmin(session);
			expect(result).toEqual({
				sub: "",
				email: "admin@example.com",
				name: "",
				image: undefined,
			});
		});
	});
});
