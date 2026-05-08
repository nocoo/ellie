import {
	PROFILE_TABS,
	buildProfileStats,
	formatBirthday,
	formatGender,
	formatLastActivity,
	formatLocation,
	formatOlTime,
	formatUserRole,
	formatUserStatus,
	getUserRoleBadgeVariant,
	resolveTab,
} from "@/viewmodels/forum/user-profile";
import { UserRole, UserStatus } from "@ellie/types";
import type { User } from "@ellie/types";
import { describe, expect, it } from "vitest";

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
		coins: 0,
		signature: "",
		groupTitle: "",
		groupStars: 0,
		groupColor: "",
		customTitle: "",
		digestPosts: 0,
		olTime: 0,
		gender: 0,
		birthYear: 0,
		birthMonth: 0,
		birthDay: 0,
		resideProvince: "",
		resideCity: "",
		graduateSchool: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
		lastActivity: 0,
		emailVerifiedAt: 0,
		emailNormalized: "",
		emailChangedAt: 0,
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
		const user = makeUser({ id: 1, threads: 5, posts: 30, credits: 200, coins: 100 });
		const stats = buildProfileStats(user);
		expect(stats).toEqual({ threads: 5, posts: 30, credits: 200, coins: 100 });
	});

	it("handles zero values", () => {
		const user = makeUser({ id: 1, threads: 0, posts: 0, credits: 0, coins: 0 });
		const stats = buildProfileStats(user);
		expect(stats).toEqual({ threads: 0, posts: 0, credits: 0, coins: 0 });
	});
});

// ---------------------------------------------------------------------------
// getUserRoleBadgeVariant
// ---------------------------------------------------------------------------

describe("getUserRoleBadgeVariant", () => {
	it("returns destructive for Admin", () => {
		expect(getUserRoleBadgeVariant(UserRole.Admin)).toBe("destructive");
	});

	it("returns default for SuperMod", () => {
		expect(getUserRoleBadgeVariant(UserRole.SuperMod)).toBe("default");
	});

	it("returns secondary for Mod", () => {
		expect(getUserRoleBadgeVariant(UserRole.Mod)).toBe("secondary");
	});

	it("returns outline for User", () => {
		expect(getUserRoleBadgeVariant(UserRole.User)).toBe("outline");
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

	it("resolves digest tab", () => {
		expect(resolveTab("digest")).toBe("digest");
	});

	it("treats unknown values as threads", () => {
		expect(resolveTab("invalid")).toBe("threads");
	});

	it("treats empty string as threads", () => {
		expect(resolveTab("")).toBe("threads");
	});
});

// ---------------------------------------------------------------------------
// PROFILE_TABS
// ---------------------------------------------------------------------------

describe("PROFILE_TABS", () => {
	it("has 3 tabs", () => {
		expect(PROFILE_TABS).toHaveLength(3);
	});

	it("has correct keys", () => {
		const keys = PROFILE_TABS.map((t) => t.key);
		expect(keys).toEqual(["threads", "posts", "digest"]);
	});

	it("has labels for all tabs", () => {
		for (const tab of PROFILE_TABS) {
			expect(tab.label).toBeTruthy();
		}
	});
});

// ---------------------------------------------------------------------------
// formatGender
// ---------------------------------------------------------------------------

describe("formatGender", () => {
	it("returns 男 for 1", () => {
		expect(formatGender(1)).toBe("男");
	});

	it("returns 女 for 2", () => {
		expect(formatGender(2)).toBe("女");
	});

	it("returns null for 0", () => {
		expect(formatGender(0)).toBeNull();
	});

	it("returns null for unknown value", () => {
		expect(formatGender(99)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// formatBirthday
// ---------------------------------------------------------------------------

describe("formatBirthday", () => {
	it("returns null when all zero", () => {
		expect(formatBirthday(0, 0, 0)).toBeNull();
	});

	it("formats full birthday", () => {
		expect(formatBirthday(2000, 6, 15)).toBe("2000年6月15日");
	});

	it("formats year and month only", () => {
		expect(formatBirthday(2000, 6, 0)).toBe("2000年6月");
	});

	it("formats year only", () => {
		expect(formatBirthday(2000, 0, 0)).toBe("2000年");
	});

	it("formats month and day only", () => {
		expect(formatBirthday(0, 6, 15)).toBe("6月15日");
	});

	it("formats month only", () => {
		expect(formatBirthday(0, 6, 0)).toBe("6月");
	});

	it("formats day only", () => {
		expect(formatBirthday(0, 0, 15)).toBe("15日");
	});
});

// ---------------------------------------------------------------------------
// formatLocation
// ---------------------------------------------------------------------------

describe("formatLocation", () => {
	it("returns null when both empty", () => {
		expect(formatLocation(undefined, undefined)).toBeNull();
		expect(formatLocation(null, null)).toBeNull();
		expect(formatLocation("", "")).toBeNull();
	});

	it("returns province only when city is empty", () => {
		expect(formatLocation("Shanghai", undefined)).toBe("Shanghai");
		expect(formatLocation("Shanghai", "")).toBe("Shanghai");
		expect(formatLocation("Shanghai", null)).toBe("Shanghai");
	});

	it("returns city only when province is empty", () => {
		expect(formatLocation(undefined, "Pudong")).toBe("Pudong");
		expect(formatLocation("", "Pudong")).toBe("Pudong");
		expect(formatLocation(null, "Pudong")).toBe("Pudong");
	});

	it("returns province and city together", () => {
		expect(formatLocation("Shanghai", "Pudong")).toBe("Shanghai Pudong");
	});

	it("trims whitespace", () => {
		expect(formatLocation("  Shanghai  ", "  Pudong  ")).toBe("Shanghai Pudong");
	});

	it("trims and returns non-empty province", () => {
		expect(formatLocation("  Shanghai  ", "")).toBe("Shanghai");
	});
});

// ---------------------------------------------------------------------------
// formatOlTime
// ---------------------------------------------------------------------------

describe("formatOlTime", () => {
	it("returns null for zero", () => {
		expect(formatOlTime(0)).toBeNull();
	});

	it("returns null for negative", () => {
		expect(formatOlTime(-5)).toBeNull();
	});

	it("formats hours with locale number", () => {
		const result = formatOlTime(100);
		expect(result).toContain("小时");
	});

	it("formats large hours with separators", () => {
		const result = formatOlTime(12345);
		expect(result).toContain("小时");
	});
});

// ---------------------------------------------------------------------------
// formatLastActivity
// ---------------------------------------------------------------------------

describe("formatLastActivity", () => {
	it("returns null for zero timestamp", () => {
		expect(formatLastActivity(0)).toBeNull();
	});

	it("returns null for negative timestamp", () => {
		expect(formatLastActivity(-1)).toBeNull();
	});

	it("returns formatted date for valid timestamp", () => {
		const ts = new Date("2024-06-15T00:00:00Z").getTime() / 1000;
		const result = formatLastActivity(ts);
		expect(result).not.toBeNull();
		expect(typeof result).toBe("string");
	});
});
