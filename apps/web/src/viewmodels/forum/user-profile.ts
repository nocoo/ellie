// viewmodels/forum/user-profile.ts — User profile pure logic
// Ref: 04d §UserProfile — formatting helpers, tab types

import { formatLocaleDate, formatNumber } from "@/viewmodels/shared/formatting";
import {
	type User,
	type UserCheckinSummary,
	type UserPostHistoryItem,
	UserRole,
	UserStatus,
} from "@ellie/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileTab = "threads" | "posts" | "digest";

export interface ProfileStats {
	threads: number;
	posts: number;
	credits: number;
	coins: number;
}

export const PROFILE_TABS: { key: ProfileTab; label: string }[] = [
	{ key: "threads", label: "主题" },
	{ key: "posts", label: "回复" },
	{ key: "digest", label: "精华" },
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
		coins: user.coins ?? 0,
	};
}

/** Resolve profile tab from URL search param value. */
export function resolveTab(raw: string | undefined): ProfileTab {
	if (raw === "posts") return "posts";
	if (raw === "digest") return "digest";
	return "threads";
}

/**
 * Runtime guard for the new `UserPostHistoryItem` shape (`{ post, thread }`).
 *
 * Defends against a partially-deployed environment where the web app already
 * imports the new type but the Worker still returns plain `Post[]` — we must
 * NOT cast such payloads or destructure `item.post`, both would crash at
 * render time.
 *
 * The guard validates EVERY field `UserProfileListRow` actually reads, not
 * just the discriminating pair `{post, thread}`. In particular `replies`,
 * `views`, `lastPostAt`, `closed/sticky/digest/special/highlight` and
 * `typeName` are all required — `formatCompactNumber(thread.replies)` and
 * the badge helpers would otherwise throw on a partial payload that happens
 * to carry `post`/`thread` envelopes but missing inner fields. Lives in this
 * non-server-only module so `UserPostsTab` can reuse the same check.
 */
export function isUserPostHistoryItem(value: unknown): value is UserPostHistoryItem {
	if (!value || typeof value !== "object") return false;
	const v = value as { post?: unknown; thread?: unknown };
	if (!v.post || typeof v.post !== "object") return false;
	if (!v.thread || typeof v.thread !== "object") return false;
	const p = v.post as { id?: unknown; createdAt?: unknown };
	if (typeof p.id !== "number" || typeof p.createdAt !== "number") return false;
	const t = v.thread as {
		id?: unknown;
		forumId?: unknown;
		subject?: unknown;
		replies?: unknown;
		views?: unknown;
		createdAt?: unknown;
		lastPostAt?: unknown;
		closed?: unknown;
		sticky?: unknown;
		digest?: unknown;
		special?: unknown;
		highlight?: unknown;
		typeName?: unknown;
	};
	return (
		typeof t.id === "number" &&
		typeof t.forumId === "number" &&
		typeof t.subject === "string" &&
		typeof t.replies === "number" &&
		typeof t.views === "number" &&
		typeof t.createdAt === "number" &&
		typeof t.lastPostAt === "number" &&
		typeof t.closed === "number" &&
		typeof t.sticky === "number" &&
		typeof t.digest === "number" &&
		typeof t.special === "number" &&
		typeof t.highlight === "number" &&
		typeof t.typeName === "string"
	);
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
export function formatLocation(
	province: string | undefined | null,
	city: string | undefined | null,
): string | null {
	const p = (province ?? "").trim();
	const c = (city ?? "").trim();
	if (!p && !c) return null;
	if (p && c) return `${p} ${c}`;
	return p || c;
}

/** Format online time in hours to a human-readable string. */
export function formatOlTime(hours: number): string | null {
	if (hours <= 0) return null;
	return `${formatNumber(hours)} 小时`;
}

/** Format Unix timestamp to relative or absolute date. */
export function formatLastActivity(timestamp: number): string | null {
	return formatLocaleDate(timestamp);
}

// ---------------------------------------------------------------------------
// Check-in formatting
// ---------------------------------------------------------------------------

/**
 * Format the check-in level label, e.g. "Lv.5 常住居民I".
 * Returns null when the user has no resolved level (never checked in).
 */
export function formatCheckinLevel(checkin: UserCheckinSummary | null): string | null {
	if (!checkin || !checkin.level) return null;
	return `Lv.${checkin.level.level} ${checkin.level.label}`;
}

/**
 * Format cumulative check-in days, e.g. "签到 365 天".
 * Returns null for non-positive values.
 */
export function formatCheckinDays(totalDays: number | undefined | null): string | null {
	if (!totalDays || totalDays <= 0) return null;
	return `签到 ${formatNumber(totalDays)} 天`;
}
