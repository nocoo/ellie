import { describe, expect, it } from "bun:test";
import { createMockDataStore } from "@ellie/test-mocks";
import { createMockUserRepository } from "@ellie/test-mocks";
import { UserRole, UserStatus } from "@ellie/types";

describe("createMockUserRepository", () => {
	const store = createMockDataStore();
	const repo = createMockUserRepository(store);

	// ─── list ──────────────────────────────────────────────

	describe("list", () => {
		it("returns all users with default params", async () => {
			const result = await repo.list({});
			expect(result.items.length).toBe(store.users.length);
			expect(result.total).toBe(store.users.length);
			expect(result.nextCursor).toBeNull();
			expect(result.prevCursor).toBeNull();
		});

		it("sorts by regDate descending (newest) by default", async () => {
			const result = await repo.list({});
			const ids = result.items.map((u) => u.id);
			for (let i = 1; i < ids.length; i++) {
				const prev = store.users.find((u) => u.id === ids[i - 1]);
				const curr = store.users.find((u) => u.id === ids[i]);
				expect(prev).toBeDefined();
				expect(curr).toBeDefined();
				expect((prev as NonNullable<typeof prev>).regDate).toBeGreaterThanOrEqual(
					(curr as NonNullable<typeof curr>).regDate,
				);
			}
		});

		it("sorts by lastLogin when sort=lastLogin", async () => {
			const result = await repo.list({ sort: "lastLogin" });
			const items = result.items;
			for (let i = 1; i < items.length; i++) {
				expect(items[i - 1].lastLogin).toBeGreaterThanOrEqual(items[i].lastLogin);
			}
		});

		it("filters by search (case-insensitive)", async () => {
			const result = await repo.list({ search: "Admin" });
			expect(result.items.length).toBe(1);
			expect(result.items[0].username).toBe("admin");
		});

		it("filters by search with partial match", async () => {
			const result = await repo.list({ search: "zhang" });
			expect(result.items.length).toBe(1);
			expect(result.items[0].username).toBe("zhangsan");
		});

		it("returns empty when search matches nothing", async () => {
			const result = await repo.list({ search: "nonexistent" });
			expect(result.items.length).toBe(0);
			expect(result.total).toBe(0);
		});

		it("filters by role", async () => {
			const result = await repo.list({ role: UserRole.Admin });
			expect(result.items.every((u) => u.role === UserRole.Admin)).toBe(true);
		});

		it("filters by status", async () => {
			const result = await repo.list({ status: UserStatus.Banned });
			expect(result.items.length).toBe(1);
			expect(result.items[0].username).toBe("wangwu");
		});

		it("filters by status=Active", async () => {
			const result = await repo.list({ status: UserStatus.Active });
			expect(result.items.every((u) => u.status === UserStatus.Active)).toBe(true);
		});

		it("filters by lastLoginAfter", async () => {
			const threshold = 1711353600; // 2024-03-25
			const result = await repo.list({ lastLoginAfter: threshold });
			expect(result.items.every((u) => u.lastLogin >= threshold)).toBe(true);
		});

		it("combines multiple filters", async () => {
			const result = await repo.list({
				status: UserStatus.Active,
				role: UserRole.User,
			});
			expect(
				result.items.every((u) => u.status === UserStatus.Active && u.role === UserRole.User),
			).toBe(true);
		});

		it("respects limit param", async () => {
			const result = await repo.list({ limit: 2 });
			expect(result.items.length).toBe(2);
		});

		it("returns nextCursor when there are more items", async () => {
			const result = await repo.list({ limit: 2 });
			expect(result.nextCursor).not.toBeNull();
		});

		it("returns null nextCursor when all items fit in one page", async () => {
			const result = await repo.list({ limit: 100 });
			expect(result.nextCursor).toBeNull();
		});

		it("returns null prevCursor when no cursor is provided", async () => {
			const result = await repo.list({ limit: 2 });
			expect(result.prevCursor).toBeNull();
		});

		it("paginates forward using cursor", async () => {
			const page1 = await repo.list({ limit: 2 });
			expect(page1.nextCursor).not.toBeNull();
			const cursor1 = page1.nextCursor as string;

			const page2 = await repo.list({ limit: 2, cursor: cursor1 });
			expect(page2.items.length).toBe(2);
			expect(page2.prevCursor).not.toBeNull();
			// No overlap between pages
			const page1Ids = page1.items.map((u) => u.id);
			const page2Ids = page2.items.map((u) => u.id);
			expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
		});

		it("paginates backward using cursor", async () => {
			// First get a forward cursor
			const page1 = await repo.list({ limit: 2, sort: "newest" });
			expect(page1.nextCursor).not.toBeNull();
			const cursor1 = page1.nextCursor as string;

			const page2 = await repo.list({ limit: 2, sort: "newest", cursor: cursor1 });
			expect(page2.prevCursor).not.toBeNull();
			const cursor2 = page2.prevCursor as string;

			// Now go backward from page2's prevCursor
			const backPage = await repo.list({
				limit: 2,
				sort: "newest",
				cursor: cursor2,
				direction: "backward",
			});
			expect(backPage.items.length).toBeGreaterThan(0);
		});

		it("handles invalid cursor gracefully (decodeCursor returns null)", async () => {
			const invalidCursor = btoa("not-valid-json");
			const result = await repo.list({ cursor: invalidCursor });
			// When decodeCursor returns null, no filtering happens, returns all items up to limit
			expect(result.items.length).toBeGreaterThan(0);
		});

		it("returns prevCursor when using cursor and items exist", async () => {
			const page1 = await repo.list({ limit: 2 });
			expect(page1.nextCursor).not.toBeNull();
			const cursor1 = page1.nextCursor as string;

			const page2 = await repo.list({ limit: 2, cursor: cursor1 });
			expect(page2.prevCursor).not.toBeNull();
		});
	});

	// ─── getById ───────────────────────────────────────────

	describe("getById", () => {
		it("returns user by id", async () => {
			const user = await repo.getById(1);
			expect(user).not.toBeNull();
			expect(user?.id).toBe(1);
			expect(user?.username).toBe("admin");
		});

		it("returns null for non-existent id", async () => {
			const user = await repo.getById(99999);
			expect(user).toBeNull();
		});
	});

	// ─── setStatus ─────────────────────────────────────────

	describe("setStatus", () => {
		it("updates user status", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockUserRepository(freshStore);

			await freshRepo.setStatus(10, UserStatus.Banned);
			const user = await freshRepo.getById(10);
			expect(user?.status).toBe(UserStatus.Banned);
		});

		it("throws when user not found", async () => {
			expect(repo.setStatus(99999, UserStatus.Banned)).rejects.toThrow("User 99999 not found");
		});
	});

	// ─── setRole ───────────────────────────────────────────

	describe("setRole", () => {
		it("updates user role", async () => {
			const freshStore = createMockDataStore();
			const freshRepo = createMockUserRepository(freshStore);

			await freshRepo.setRole(10, UserRole.Admin);
			const user = await freshRepo.getById(10);
			expect(user?.role).toBe(UserRole.Admin);
		});

		it("throws when user not found", async () => {
			expect(repo.setRole(99999, UserRole.Admin)).rejects.toThrow("User 99999 not found");
		});
	});
});
