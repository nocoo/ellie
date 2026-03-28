import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isAdmin, resolveAdmin } from "../../../apps/web/src/lib/admin";

describe("isAdmin", () => {
	const originalEnv = process.env.ADMIN_EMAILS;

	afterEach(() => {
		if (originalEnv === undefined) {
			process.env.ADMIN_EMAILS = undefined;
		} else {
			process.env.ADMIN_EMAILS = originalEnv;
		}
	});

	it("returns false when env is not set", () => {
		process.env.ADMIN_EMAILS = undefined;
		expect(isAdmin("user@example.com")).toBe(false);
	});

	it("returns false for null/undefined", () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		expect(isAdmin(null)).toBe(false);
		expect(isAdmin(undefined)).toBe(false);
	});

	it("returns true for matching email", () => {
		process.env.ADMIN_EMAILS = "a@example.com,b@example.com,c@example.com";
		expect(isAdmin("b@example.com")).toBe(true);
	});

	it("returns false for non-matching email", () => {
		process.env.ADMIN_EMAILS = "a@example.com,b@example.com";
		expect(isAdmin("z@example.com")).toBe(false);
	});

	it("is case-insensitive", () => {
		process.env.ADMIN_EMAILS = "Admin@Example.COM";
		expect(isAdmin("admin@example.com")).toBe(true);
		expect(isAdmin("ADMIN@EXAMPLE.COM")).toBe(true);
	});

	it("trims whitespace from env values", () => {
		process.env.ADMIN_EMAILS = " a@x.com , b@x.com , c@x.com ";
		expect(isAdmin("b@x.com")).toBe(true);
	});

	it("handles empty env string", () => {
		process.env.ADMIN_EMAILS = "";
		expect(isAdmin("user@example.com")).toBe(false);
	});
});

describe("resolveAdmin", () => {
	const originalEnv = process.env.ADMIN_EMAILS;

	beforeEach(() => {
		process.env.ADMIN_EMAILS = "admin@example.com,super@example.com";
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			process.env.ADMIN_EMAILS = undefined;
		} else {
			process.env.ADMIN_EMAILS = originalEnv;
		}
	});

	it("returns null for null session", () => {
		expect(resolveAdmin(null)).toBeNull();
	});

	it("returns null for session without user", () => {
		expect(resolveAdmin({ user: undefined })).toBeNull();
	});

	it("returns null for non-admin user", () => {
		const session = {
			user: { id: "123", email: "user@example.com", name: "User", image: null },
		};
		expect(resolveAdmin(session)).toBeNull();
	});

	it("returns admin info for admin user", () => {
		const session = {
			user: {
				id: "google-sub-123",
				email: "admin@example.com",
				name: "Admin",
				image: "https://example.com/avatar.jpg",
			},
		};
		const result = resolveAdmin(session);
		expect(result).toEqual({
			sub: "google-sub-123",
			email: "admin@example.com",
			name: "Admin",
			image: "https://example.com/avatar.jpg",
		});
	});

	it("handles missing optional fields gracefully", () => {
		const session = {
			user: { id: "456", email: "super@example.com" },
		};
		const result = resolveAdmin(session);
		expect(result).toEqual({
			sub: "456",
			email: "super@example.com",
			name: "",
			image: undefined,
		});
	});
});
