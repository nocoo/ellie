import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { UserRole, UserStatus } from "@/models/types";
import {
	fetchUserPosts,
	fetchUserProfile,
	fetchUserThreads,
	getUserRoleLabel,
	getUserStatusLabel,
} from "@/viewmodels/forum/user-profile";

describe("user-profile ViewModel", () => {
	describe("getUserRoleLabel", () => {
		test("maps all roles", () => {
			expect(getUserRoleLabel(UserRole.Admin)).toBe("Admin");
			expect(getUserRoleLabel(UserRole.SuperMod)).toBe("Super Moderator");
			expect(getUserRoleLabel(UserRole.Mod)).toBe("Moderator");
			expect(getUserRoleLabel(UserRole.User)).toBe("Member");
		});
	});

	describe("getUserStatusLabel", () => {
		test("maps all statuses", () => {
			expect(getUserStatusLabel(UserStatus.Active)).toBe("Active");
			expect(getUserStatusLabel(UserStatus.Banned)).toBe("Banned");
			expect(getUserStatusLabel(UserStatus.Archived)).toBe("Archived");
		});
	});

	describe("fetchUserProfile", () => {
		test("returns null for non-existent user", async () => {
			const repos = createRepositories();
			const result = await fetchUserProfile(repos, 999999);
			expect(result).toBeNull();
		});

		test("returns user data with labels", async () => {
			const repos = createRepositories();
			const users = await repos.users.list({});
			if (users.items.length === 0) throw new Error("No users");
			const user = users.items[0];

			const result = await fetchUserProfile(repos, user.id);
			if (!result) throw new Error("Expected result");
			expect(result.user.id).toBe(user.id);
			expect(result.roleLabel).toBeDefined();
			expect(result.statusLabel).toBeDefined();
		});
	});

	describe("fetchUserThreads", () => {
		test("returns paginated result", async () => {
			const repos = createRepositories();
			const users = await repos.users.list({});
			if (users.items.length === 0) throw new Error("No users");

			const result = await fetchUserThreads(repos, users.items[0].id);
			expect(Array.isArray(result.items)).toBe(true);
			expect(typeof result.total).toBe("number");
		});
	});

	describe("fetchUserPosts", () => {
		test("returns paginated result", async () => {
			const repos = createRepositories();
			const users = await repos.users.list({});
			if (users.items.length === 0) throw new Error("No users");

			const result = await fetchUserPosts(repos, users.items[0].id);
			expect(Array.isArray(result.items)).toBe(true);
			expect(typeof result.total).toBe("number");
		});
	});
});
