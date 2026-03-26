import { beforeEach, describe, expect, test } from "bun:test";
import type { UserRepository } from "@/data/repositories/types";
import { createMockUserRepository } from "@/data/repositories/user.repository";
import { UserRole, UserStatus } from "@/models/types";

let repo: UserRepository;

beforeEach(() => {
	repo = createMockUserRepository();
});

describe("MockUserRepository", () => {
	describe("list", () => {
		test("returns all users with default params", async () => {
			const result = await repo.list({});
			expect(result.items.length).toBeGreaterThan(0);
		});

		test("searches by username (case insensitive)", async () => {
			const result = await repo.list({ search: "ADMIN" });
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.username.toLowerCase()).toContain("admin");
			}
		});

		test("filters by role", async () => {
			const result = await repo.list({ role: UserRole.Admin });
			for (const u of result.items) {
				expect(u.role).toBe(UserRole.Admin);
			}
		});

		test("filters by status", async () => {
			const result = await repo.list({ status: UserStatus.Banned });
			for (const u of result.items) {
				expect(u.status).toBe(UserStatus.Banned);
			}
		});

		test("filters by lastLoginAfter", async () => {
			const cutoff = 1711000000;
			const result = await repo.list({ lastLoginAfter: cutoff });
			for (const u of result.items) {
				expect(u.lastLogin).toBeGreaterThanOrEqual(cutoff);
			}
		});

		test("sorts by newest (regDate desc) by default", async () => {
			const result = await repo.list({});
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].regDate).toBeGreaterThanOrEqual(result.items[i].regDate);
			}
		});

		test("sorts by lastLogin", async () => {
			const result = await repo.list({ sort: "lastLogin" });
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].lastLogin).toBeGreaterThanOrEqual(result.items[i].lastLogin);
			}
		});

		test("respects limit", async () => {
			const result = await repo.list({ limit: 2 });
			expect(result.items.length).toBeLessThanOrEqual(2);
		});

		test("search returns empty for no match", async () => {
			const result = await repo.list({ search: "ZZZZNONEXISTENT" });
			expect(result.items).toHaveLength(0);
		});
	});

	describe("getById", () => {
		test("returns user when exists", async () => {
			const found = await repo.getById(1);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(1);
		});

		test("returns null when not found", async () => {
			expect(await repo.getById(999999)).toBeNull();
		});
	});

	describe("setStatus", () => {
		test("updates user status", async () => {
			await repo.setStatus(1, UserStatus.Banned);
			const updated = await repo.getById(1);
			expect(updated!.status).toBe(UserStatus.Banned);
		});

		test("throws for non-existent user", async () => {
			expect(repo.setStatus(999999, UserStatus.Active)).rejects.toThrow("User 999999 not found");
		});
	});

	describe("setRole", () => {
		test("updates user role", async () => {
			await repo.setRole(10, UserRole.Mod);
			const updated = await repo.getById(10);
			expect(updated!.role).toBe(UserRole.Mod);
		});

		test("throws for non-existent user", async () => {
			expect(repo.setRole(999999, UserRole.User)).rejects.toThrow("User 999999 not found");
		});
	});
});
