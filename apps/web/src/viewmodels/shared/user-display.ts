// viewmodels/shared/user-display.ts — User display utilities
//
// Pure functions for rendering user role badges and activity timestamps.
// Extracted from components/forum/user-popover.tsx for independent testability.

import type { UserRole } from "@ellie/types";
import { formatLocaleDate } from "./formatting";

// ---------------------------------------------------------------------------
// Role badge
// ---------------------------------------------------------------------------

export interface RoleBadge {
	label: string;
	variant: "default" | "secondary" | "outline";
}

/**
 * Map a UserRole to a display badge configuration.
 * Returns null for regular users (role = 0) who get no badge.
 */
export function getRoleBadge(role: UserRole): RoleBadge | null {
	switch (role) {
		case 1:
			return { label: "管理员", variant: "default" };
		case 2:
			return { label: "超级版主", variant: "secondary" };
		case 3:
			return { label: "版主", variant: "secondary" };
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Last active formatting
// ---------------------------------------------------------------------------

/**
 * Format a "last active" timestamp as relative time if recent, absolute date otherwise.
 *
 * Similar to shared `formatRelativeTime` but uses "从未" for zero (never logged in)
 * and "未知" for null/undefined values — semantics specific to user activity display.
 *
 * - 0: "从未"
 * - < 60s: "刚刚"
 * - < 1h: "X 分钟前"
 * - < 24h: "X 小时前"
 * - < 30d: "X 天前"
 * - older: locale date (zh-CN)
 */
export function formatLastActive(timestamp: number): string {
	if (!timestamp) return "从未";
	const now = Date.now();
	const diff = now - timestamp * 1000;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes} 分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} 天前`;
	return formatLocaleDate(timestamp) ?? "从未";
}
