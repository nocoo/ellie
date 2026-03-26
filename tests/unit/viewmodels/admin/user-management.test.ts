import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { UserRole, UserStatus } from "@/models/types";
import {
	DEFAULT_FILTERS,
	createUserActions,
	fetchUserList,
} from "@/viewmodels/admin/user-management";

describe("user-management ViewModel", () => {
	describe("DEFAULT_FILTERS", () => {
		test("has empty search", () => {
			expect(DEFAULT_FILTERS.search).toBe("");
		});

		test("has null role filter", () => {
			expect(DEFAULT_FILTERS.role).toBeNull();
		});

		test("has null status filter", () => {
			expect(DEFAULT_FILTERS.status).toBeNull();
		});
	});

	describe("fetchUserList", () => {
		test("returns paginated user list with default filters", async () => {
			const repos = createRepositories();
			const result = await fetchUserList(repos, DEFAULT_FILTERS);
			expect(result.items.length).toBeGreaterThan(0);
			expect(typeof result.total).toBe("number");
		});

		test("filters by search term", async () => {
			const repos = createRepositories();
			const result = await fetchUserList(repos, { ...DEFAULT_FILTERS, search: "admin" });
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.username.toLowerCase()).toContain("admin");
			}
		});

		test("filters by role", async () => {
			const repos = createRepositories();
			const result = await fetchUserList(repos, { ...DEFAULT_FILTERS, role: UserRole.Admin });
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.role).toBe(UserRole.Admin);
			}
		});

		test("filters by status", async () => {
			const repos = createRepositories();
			const result = await fetchUserList(repos, {
				...DEFAULT_FILTERS,
				status: UserStatus.Banned,
			});
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.status).toBe(UserStatus.Banned);
			}
		});

		test("respects limit", async () => {
			const repos = createRepositories();
			const result = await fetchUserList(repos, DEFAULT_FILTERS, undefined, undefined, 2);
			expect(result.items.length).toBeLessThanOrEqual(2);
		});

		test("returns empty for no match search", async () => {
			const repos = createRepositories();
			const result = await fetchUserList(repos, {
				...DEFAULT_FILTERS,
				search: "NONEXISTENT_USER_XYZ",
			});
			expect(result.items).toHaveLength(0);
		});
	});

	describe("createUserActions", () => {
		test("banUser sets status to Banned", async () => {
			const repos = createRepositories();
			const actions = createUserActions(repos);

			// Find an active user
			const users = await repos.users.list({ status: UserStatus.Active });
			expect(users.items.length).toBeGreaterThan(0);
			const target = users.items[0];

			await actions.banUser(target.id);
			const updated = await repos.users.getById(target.id);
			expect(updated?.status).toBe(UserStatus.Banned);
		});

		test("unbanUser sets status to Active", async () => {
			const repos = createRepositories();
			const actions = createUserActions(repos);

			// Find a banned user
			const banned = await repos.users.list({ status: UserStatus.Banned });
			expect(banned.items.length).toBeGreaterThan(0);
			const target = banned.items[0];

			await actions.unbanUser(target.id);
			const updated = await repos.users.getById(target.id);
			expect(updated?.status).toBe(UserStatus.Active);
		});

		test("changeRole updates user role", async () => {
			const repos = createRepositories();
			const actions = createUserActions(repos);

			const users = await repos.users.list({});
			const regularUser = users.items.find((u) => u.role === UserRole.User);
			expect(regularUser).toBeDefined();

			await actions.changeRole(regularUser?.id, UserRole.Mod);
			const updated = await repos.users.getById(regularUser?.id);
			expect(updated?.role).toBe(UserRole.Mod);
		});
	});
});
