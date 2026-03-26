import { describe, expect, test } from "bun:test";
import { validateMockCredentials } from "@/auth";
import { UserRole } from "@/models/types";

describe("validateMockCredentials", () => {
	test("valid admin credentials → returns user", () => {
		const user = validateMockCredentials("admin", "admin");
		expect(user).not.toBeNull();
		expect(user!.username).toBe("admin");
		expect(user!.role).toBe(UserRole.Admin);
	});

	test("valid regular user credentials → returns user", () => {
		const user = validateMockCredentials("zhangsan", "zhangsan");
		expect(user).not.toBeNull();
		expect(user!.username).toBe("zhangsan");
		expect(user!.role).toBe(UserRole.User);
	});

	test("wrong password → returns null", () => {
		expect(validateMockCredentials("admin", "wrongpassword")).toBeNull();
	});

	test("non-existent user → returns null", () => {
		expect(validateMockCredentials("nonexistent", "anything")).toBeNull();
	});

	test("banned user → returns null", () => {
		// wangwu is banned in mock data
		expect(validateMockCredentials("wangwu", "wangwu")).toBeNull();
	});

	test("archived user → returns null", () => {
		// olduser is archived in mock data
		expect(validateMockCredentials("olduser", "olduser")).toBeNull();
	});

	test("supermod credentials → returns user with SuperMod role", () => {
		const user = validateMockCredentials("supermod", "supermod");
		expect(user).not.toBeNull();
		expect(user!.role).toBe(UserRole.SuperMod);
	});

	test("mod credentials → returns user with Mod role", () => {
		const user = validateMockCredentials("mod_tech", "mod_tech");
		expect(user).not.toBeNull();
		expect(user!.role).toBe(UserRole.Mod);
	});
});
