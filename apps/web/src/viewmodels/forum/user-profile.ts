// viewmodels/forum/user-profile.ts — User profile pure logic
// Ref: 04d §UserProfile — formatting helpers, tab types

import { type User, UserRole, UserStatus } from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileTab = "threads" | "posts";

export interface ProfileStats {
	threads: number;
	posts: number;
	credits: number;
}

export const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
	{ key: "threads", label: "发帖历史" },
	{ key: "posts", label: "回帖历史" },
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
	return "threads";
}
