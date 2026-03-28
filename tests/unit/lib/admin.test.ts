import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isAdminGoogleId, resolveAdmin } from "../../../apps/web/src/lib/admin";

describe("isAdminGoogleId", () => {
	const originalEnv = process.env.ADMIN_GOOGLE_IDS;

	afterEach(() => {
		if (originalEnv === undefined) {
			process.env.ADMIN_GOOGLE_IDS = undefined;
		} else {
			process.env.ADMIN_GOOGLE_IDS = originalEnv;
		}
	});

	it("returns false when env is not set", () => {
		process.env.ADMIN_GOOGLE_IDS = undefined;
		expect(isAdminGoogleId("12345")).toBe(false);
	});

	it("returns false for null/undefined", () => {
		process.env.ADMIN_GOOGLE_IDS = "12345";
		expect(isAdminGoogleId(null)).toBe(false);
		expect(isAdminGoogleId(undefined)).toBe(false);
	});

	it("returns true for matching sub", () => {
		process.env.ADMIN_GOOGLE_IDS = "111,222,333";
		expect(isAdminGoogleId("222")).toBe(true);
	});

	it("returns false for non-matching sub", () => {
		process.env.ADMIN_GOOGLE_IDS = "111,222,333";
		expect(isAdminGoogleId("999")).toBe(false);
	});

	it("trims whitespace from env values", () => {
		process.env.ADMIN_GOOGLE_IDS = " 111 , 222 , 333 ";
		expect(isAdminGoogleId("222")).toBe(true);
	});

	it("handles empty env string", () => {
		process.env.ADMIN_GOOGLE_IDS = "";
		expect(isAdminGoogleId("12345")).toBe(false);
	});
});

describe("resolveAdmin", () => {
	const originalEnv = process.env.ADMIN_GOOGLE_IDS;

	beforeEach(() => {
		process.env.ADMIN_GOOGLE_IDS = "admin-sub-1,admin-sub-2";
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			process.env.ADMIN_GOOGLE_IDS = undefined;
		} else {
			process.env.ADMIN_GOOGLE_IDS = originalEnv;
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
			user: { id: "non-admin-sub", email: "user@example.com", name: "User", image: null },
		};
		expect(resolveAdmin(session)).toBeNull();
	});

	it("returns admin info for admin user", () => {
		const session = {
			user: {
				id: "admin-sub-1",
				email: "admin@example.com",
				name: "Admin",
				image: "https://example.com/avatar.jpg",
			},
		};
		const result = resolveAdmin(session);
		expect(result).toEqual({
			sub: "admin-sub-1",
			email: "admin@example.com",
			name: "Admin",
			image: "https://example.com/avatar.jpg",
		});
	});

	it("handles missing optional fields gracefully", () => {
		const session = {
			user: { id: "admin-sub-2" },
		};
		const result = resolveAdmin(session);
		expect(result).toEqual({
			sub: "admin-sub-2",
			email: "",
			name: "",
			image: undefined,
		});
	});
});
