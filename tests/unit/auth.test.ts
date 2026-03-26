import { beforeEach, describe, expect, test } from "bun:test";
import { validateMockCredentials } from "@/auth";
import { type MockDataStore, createMockDataStore } from "@/data/mock/store";
import { UserRole, UserStatus } from "@/models/types";

let store: MockDataStore;

beforeEach(() => {
	store = createMockDataStore();
});

describe("validateMockCredentials", () => {
	test("valid admin credentials → returns user", () => {
		const user = validateMockCredentials(store.users, "admin", "admin");
		expect(user).not.toBeNull();
		expect(user!.username).toBe("admin");
		expect(user!.role).toBe(UserRole.Admin);
	});

	test("valid regular user credentials → returns user", () => {
		const user = validateMockCredentials(store.users, "zhangsan", "zhangsan");
		expect(user).not.toBeNull();
		expect(user!.username).toBe("zhangsan");
		expect(user!.role).toBe(UserRole.User);
	});

	test("wrong password → returns null", () => {
		expect(validateMockCredentials(store.users, "admin", "wrongpassword")).toBeNull();
	});

	test("non-existent user → returns null", () => {
		expect(validateMockCredentials(store.users, "nonexistent", "anything")).toBeNull();
	});

	test("banned user → returns null", () => {
		// wangwu is banned in mock data
		expect(validateMockCredentials(store.users, "wangwu", "wangwu")).toBeNull();
	});

	test("archived user → returns null", () => {
		// olduser is archived in mock data
		expect(validateMockCredentials(store.users, "olduser", "olduser")).toBeNull();
	});

	test("supermod credentials → returns user with SuperMod role", () => {
		const user = validateMockCredentials(store.users, "supermod", "supermod");
		expect(user).not.toBeNull();
		expect(user!.role).toBe(UserRole.SuperMod);
	});

	test("mod credentials → returns user with Mod role", () => {
		const user = validateMockCredentials(store.users, "mod_tech", "mod_tech");
		expect(user).not.toBeNull();
		expect(user!.role).toBe(UserRole.Mod);
	});

	test("auth reflects user status mutations (shared state)", () => {
		// Initially active user can log in
		expect(validateMockCredentials(store.users, "admin", "admin")).not.toBeNull();

		// Ban the user via direct store mutation (simulating repo.setStatus)
		const admin = store.users.find((u) => u.username === "admin")!;
		admin.status = UserStatus.Banned;

		// Auth now rejects the banned user
		expect(validateMockCredentials(store.users, "admin", "admin")).toBeNull();
	});
});
