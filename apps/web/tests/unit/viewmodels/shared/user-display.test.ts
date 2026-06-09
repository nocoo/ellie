import { UserRole } from "@ellie/types";
import { describe, expect, it, vi } from "vitest";
import { formatLastActive, getRoleBadge } from "@/viewmodels/shared/user-display";

// ---------------------------------------------------------------------------
// getRoleBadge
// ---------------------------------------------------------------------------

describe("getRoleBadge", () => {
	it("returns null for regular user (role = 0)", () => {
		expect(getRoleBadge(UserRole.User)).toBeNull();
	});

	it("returns 管理员 badge for Admin (role = 1)", () => {
		expect(getRoleBadge(UserRole.Admin)).toEqual({
			label: "管理员",
			variant: "default",
		});
	});

	it("returns 超级版主 badge for SuperMod (role = 2)", () => {
		expect(getRoleBadge(UserRole.SuperMod)).toEqual({
			label: "超级版主",
			variant: "secondary",
		});
	});

	it("returns 版主 badge for Mod (role = 3)", () => {
		expect(getRoleBadge(UserRole.Mod)).toEqual({
			label: "版主",
			variant: "secondary",
		});
	});

	it("returns null for unknown role values", () => {
		expect(getRoleBadge(99 as UserRole)).toBeNull();
		expect(getRoleBadge(-1 as UserRole)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// formatLastActive
// ---------------------------------------------------------------------------

describe("formatLastActive", () => {
	it("returns '从未' for 0", () => {
		expect(formatLastActive(0)).toBe("从未");
	});

	it("returns '刚刚' for timestamps within the last minute", () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatLastActive(now)).toBe("刚刚");
		expect(formatLastActive(now - 30)).toBe("刚刚");
	});

	it("returns minutes ago for timestamps within the last hour", () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatLastActive(now - 120)).toBe("2 分钟前");
		expect(formatLastActive(now - 3540)).toBe("59 分钟前");
	});

	it("returns hours ago for timestamps within the last day", () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatLastActive(now - 3600)).toBe("1 小时前");
		expect(formatLastActive(now - 7200)).toBe("2 小时前");
		expect(formatLastActive(now - 82800)).toBe("23 小时前");
	});

	it("returns days ago for timestamps within the last 30 days", () => {
		const now = Math.floor(Date.now() / 1000);
		expect(formatLastActive(now - 86400)).toBe("1 天前");
		expect(formatLastActive(now - 86400 * 15)).toBe("15 天前");
		expect(formatLastActive(now - 86400 * 29)).toBe("29 天前");
	});

	it("returns locale date string for timestamps older than 30 days", () => {
		// Use a fixed timestamp far in the past
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));

		// 2025-01-15 (well over 30 days ago)
		const oldTimestamp = Math.floor(new Date("2025-01-15T10:00:00Z").getTime() / 1000);
		const result = formatLastActive(oldTimestamp);
		// formatLocaleDate returns "2025/01/15" format
		expect(result).toBe("2025/01/15");

		vi.useRealTimers();
	});
});
