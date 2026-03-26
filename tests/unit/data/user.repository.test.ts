import { beforeEach, describe, expect, test } from "bun:test";
import { type MockDataStore, createMockDataStore } from "@/data/mock/store";
import type { UserRepository } from "@/data/repositories/types";
import { createMockUserRepository } from "@/data/repositories/user.repository";
import { UserRole, UserStatus } from "@/models/types";

let store: MockDataStore;
let repo: UserRepository;

beforeEach(() => {
	store = createMockDataStore();
	repo = createMockUserRepository(store);
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
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.role).toBe(UserRole.Admin);
			}
		});

		test("filters by status", async () => {
			const result = await repo.list({ status: UserStatus.Banned });
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.status).toBe(UserStatus.Banned);
			}
		});

		test("filters by lastLoginAfter", async () => {
			const cutoff = 1711000000;
			const result = await repo.list({ lastLoginAfter: cutoff });
			expect(result.items.length).toBeGreaterThan(0);
			for (const u of result.items) {
				expect(u.lastLogin).toBeGreaterThanOrEqual(cutoff);
			}
		});

		test("sorts by newest (regDate desc) by default", async () => {
			const result = await repo.list({});
			expect(result.items.length).toBeGreaterThan(1);
			for (let i = 1; i < result.items.length; i++) {
				expect(result.items[i - 1].regDate).toBeGreaterThanOrEqual(result.items[i].regDate);
			}
		});

		test("sorts by lastLogin", async () => {
			const result = await repo.list({ sort: "lastLogin" });
			expect(result.items.length).toBeGreaterThan(1);
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

		// ─── Cursor pagination ─────────────────────────
		test("cursor forward pagination returns next page", async () => {
			const page1 = await repo.list({ limit: 2 });
			expect(page1.items.length).toBe(2);
			expect(page1.nextCursor).not.toBeNull();

			const page2 = await repo.list({ limit: 2, cursor: page1.nextCursor! });
			expect(page2.items.length).toBeGreaterThan(0);
			// No overlap
			const page1Ids = new Set(page1.items.map((u) => u.id));
			for (const u of page2.items) {
				expect(page1Ids.has(u.id)).toBe(false);
			}
		});

		test("cursor backward pagination returns previous page", async () => {
			const page1 = await repo.list({ limit: 2 });
			const page2 = await repo.list({ limit: 2, cursor: page1.nextCursor! });
			expect(page2.prevCursor).not.toBeNull();

			const backPage = await repo.list({
				limit: 2,
				cursor: page2.prevCursor!,
				direction: "backward",
			});
			expect(backPage.items.length).toBeGreaterThan(0);
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
			await expect(repo.setStatus(999999, UserStatus.Active)).rejects.toThrow(
				"User 999999 not found",
			);
		});
	});

	describe("setRole", () => {
		test("updates user role", async () => {
			await repo.setRole(10, UserRole.Mod);
			const updated = await repo.getById(10);
			expect(updated!.role).toBe(UserRole.Mod);
		});

		test("throws for non-existent user", async () => {
			await expect(repo.setRole(999999, UserRole.User)).rejects.toThrow("User 999999 not found");
		});
	});
});
