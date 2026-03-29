import { describe, expect, it } from "bun:test";
import {
	buildProfileStats,
	formatUserRole,
	formatUserStatus,
	resolveTab,
} from "../../../../apps/web/src/viewmodels/forum/user-profile";
import { UserRole, UserStatus } from "../../../../packages/types/src/types";
import type { User } from "../../../../packages/types/src/types";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<User> & { id: number }): User {
	return {
		username: "testuser",
		email: "test@example.com",
		avatar: "",
		status: UserStatus.Active,
		role: UserRole.User,
		regDate: 1710000000,
		lastLogin: 1710000000,
		threads: 10,
		posts: 50,
		credits: 100,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// formatUserRole
// ---------------------------------------------------------------------------

describe("formatUserRole", () => {
	it("returns 管理员 for Admin", () => {
		expect(formatUserRole(UserRole.Admin)).toBe("管理员");
	});

	it("returns 超级版主 for SuperMod", () => {
		expect(formatUserRole(UserRole.SuperMod)).toBe("超级版主");
	});

	it("returns 版主 for Mod", () => {
		expect(formatUserRole(UserRole.Mod)).toBe("版主");
	});

	it("returns 用户 for User", () => {
		expect(formatUserRole(UserRole.User)).toBe("用户");
	});
});

// ---------------------------------------------------------------------------
// formatUserStatus
// ---------------------------------------------------------------------------

describe("formatUserStatus", () => {
	it("returns 正常 for Active", () => {
		expect(formatUserStatus(UserStatus.Active)).toBe("正常");
	});

	it("returns 已封禁 for Banned", () => {
		expect(formatUserStatus(UserStatus.Banned)).toBe("已封禁");
	});

	it("returns 已归档 for Archived", () => {
		expect(formatUserStatus(UserStatus.Archived)).toBe("已归档");
	});

	it("returns 未知 for unknown value", () => {
		expect(formatUserStatus(999 as UserStatus)).toBe("未知");
	});
});

// ---------------------------------------------------------------------------
// buildProfileStats
// ---------------------------------------------------------------------------

describe("buildProfileStats", () => {
	it("extracts stats from user", () => {
		const user = makeUser({ id: 1, threads: 5, posts: 30, credits: 200 });
		const stats = buildProfileStats(user);
		expect(stats).toEqual({ threads: 5, posts: 30, credits: 200 });
	});
});

// ---------------------------------------------------------------------------
// resolveTab
// ---------------------------------------------------------------------------

describe("resolveTab", () => {
	it("defaults to threads", () => {
		expect(resolveTab(undefined)).toBe("threads");
	});

	it("resolves threads tab", () => {
		expect(resolveTab("threads")).toBe("threads");
	});

	it("resolves posts tab", () => {
		expect(resolveTab("posts")).toBe("posts");
	});

	it("treats unknown values as threads", () => {
		expect(resolveTab("invalid")).toBe("threads");
	});
});
