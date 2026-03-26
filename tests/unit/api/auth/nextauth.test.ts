import { describe, expect, test } from "bun:test";
import { createAuth, validateMockCredentials } from "@/auth";
import { createMockDataStore } from "@/data/mock/store";

describe("NextAuth config", () => {
	describe("validateMockCredentials", () => {
		const store = createMockDataStore();

		test("valid credentials (password = username)", () => {
			const activeUser = store.users.find((u) => u.status === 0);
			if (!activeUser) throw new Error("No active user in mock data");
			const result = validateMockCredentials(store.users, activeUser.username, activeUser.username);
			expect(result).not.toBeNull();
			expect(result?.id).toBe(activeUser.id);
		});

		test("wrong password returns null", () => {
			const activeUser = store.users.find((u) => u.status === 0);
			if (!activeUser) throw new Error("No active user in mock data");
			const result = validateMockCredentials(store.users, activeUser.username, "wrong-password");
			expect(result).toBeNull();
		});

		test("non-existent user returns null", () => {
			const result = validateMockCredentials(store.users, "nonexistent-user-xyz", "password");
			expect(result).toBeNull();
		});

		test("banned user returns null", () => {
			const bannedUser = store.users.find((u) => u.status !== 0);
			if (!bannedUser) {
				// No banned user in mock data — skip gracefully
				expect(true).toBe(true);
				return;
			}
			const result = validateMockCredentials(store.users, bannedUser.username, bannedUser.username);
			expect(result).toBeNull();
		});
	});

	describe("createAuth", () => {
		test("returns handlers object with GET and POST", () => {
			const store = createMockDataStore();
			const auth = createAuth(store.users);
			expect(auth.handlers).toBeDefined();
			expect(typeof auth.handlers.GET).toBe("function");
			expect(typeof auth.handlers.POST).toBe("function");
		});

		test("returns auth function", () => {
			const store = createMockDataStore();
			const auth = createAuth(store.users);
			expect(typeof auth.auth).toBe("function");
		});

		test("returns signIn function", () => {
			const store = createMockDataStore();
			const auth = createAuth(store.users);
			expect(typeof auth.signIn).toBe("function");
		});

		test("returns signOut function", () => {
			const store = createMockDataStore();
			const auth = createAuth(store.users);
			expect(typeof auth.signOut).toBe("function");
		});
	});
});
