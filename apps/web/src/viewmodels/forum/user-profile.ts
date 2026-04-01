// viewmodels/forum/user-profile.ts — User profile pure logic
// Ref: 04d §UserProfile — formatting helpers, tab types

import { formatLocaleDate } from "@/viewmodels/shared/formatting";
import { type User, UserRole, UserStatus } from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileTab = "threads" | "posts" | "digest";

export interface ProfileStats {
	threads: number;
	posts: number;
	credits: number;
}

export const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
	{ key: "threads", label: "发帖历史" },
	{ key: "posts", label: "回帖历史" },
	{ key: "digest", label: "精华帖" },
];

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format user role to display label. */
export function formatUserRole(role: UserRole): string {
	switch (role) {
		case UserRole.Admin:
			return "管理员";
		case UserRole.SuperMod:
			return "超级版主";
		case UserRole.Mod:
			return "版主";
		default:
			return "用户";
	}
}

/** Map user role to badge variant for colored display. */
export function getUserRoleBadgeVariant(
	role: UserRole,
): "default" | "secondary" | "destructive" | "outline" {
	switch (role) {
		case UserRole.Admin:
			return "destructive";
		case UserRole.SuperMod:
			return "default";
		case UserRole.Mod:
			return "secondary";
		default:
			return "outline";
	}
}

/** Format user status to display label. */
export function formatUserStatus(status: UserStatus): string {
	switch (status) {
		case UserStatus.Active:
			return "正常";
		case UserStatus.Banned:
			return "已封禁";
		case UserStatus.Archived:
			return "已归档";
		default:
			return "未知";
	}
}

/** Build user stats summary from User object. */
export function buildProfileStats(user: User): ProfileStats {
	return {
		threads: user.threads,
		posts: user.posts,
		credits: user.credits,
	};
}

/** Resolve profile tab from URL search param value. */
export function resolveTab(raw: string | undefined): ProfileTab {
	if (raw === "posts") return "posts";
	if (raw === "digest") return "digest";
	return "threads";
}

// ---------------------------------------------------------------------------
// Profile info formatting
// ---------------------------------------------------------------------------

/** Format gender number to display label. */
export function formatGender(gender: number): string | null {
	switch (gender) {
		case 1:
			return "男";
		case 2:
			return "女";
		default:
			return null;
	}
}

/** Format birthday from year/month/day. Returns null if all zeroes. */
export function formatBirthday(year: number, month: number, day: number): string | null {
	if (year === 0 && month === 0 && day === 0) return null;
	const parts: string[] = [];
	if (year > 0) parts.push(`${year}年`);
	if (month > 0) parts.push(`${month}月`);
	if (day > 0) parts.push(`${day}日`);
	return parts.join("") || null;
}

/** Format location from province/city. Returns null if both empty. */
export function formatLocation(province: string, city: string): string | null {
	const p = province.trim();
	const c = city.trim();
	if (!p && !c) return null;
	if (p && c) return `${p} ${c}`;
	return p || c;
}

/** Format online time in hours to a human-readable string. */
export function formatOlTime(hours: number): string | null {
	if (hours <= 0) return null;
	return `${hours.toLocaleString()} 小时`;
}

/** Format Unix timestamp to relative or absolute date. */
export function formatLastActivity(timestamp: number): string | null {
	return formatLocaleDate(timestamp);
}
