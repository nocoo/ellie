// lib/admin-guard.ts — Admin permission guard utilities
// Ref: 04c §权限守卫 — page-level, API-level, operation-level

import { canAccessAdmin, canManageUsers } from "@ellie/types";
import type { User } from "@ellie/types";
import { UserRole, UserStatus } from "@ellie/types";

/**
 * Resolve admin user from session data.
 * Returns the user if they have admin access, null otherwise.
 *
 * In mock phase, this constructs a minimal User from session token data.
 * Phase 2 will look up the full user from D1.
 */
export function resolveAdminFromSession(
	session: {
		user?: { id?: string; name?: string; role?: string };
	} | null,
): User | null {
	if (!session?.user?.id || !session?.user?.role) return null;

	const roleMap: Record<string, UserRole> = {
		admin: UserRole.Admin,
		supermod: UserRole.SuperMod,
		mod: UserRole.Mod,
		user: UserRole.User,
	};

	const role = roleMap[session.user.role] ?? UserRole.User;

	// Construct minimal User for permission checks
	const user: User = {
		id: Number(session.user.id),
		username: session.user.name ?? "",
		email: "",
		avatar: "",
		role,
		status: UserStatus.Active, // If they have a session, they were active at login
		regDate: 0,
		lastLogin: 0,
		posts: 0,
		threads: 0,
		credits: 0,
	};

	if (!canAccessAdmin(user)) return null;
	return user;
}

/**
 * Check if the resolved admin user can manage other users.
 * Admin only — SuperMod can view but not manage.
 */
export function canAdminManageUsers(user: User | null): boolean {
	return canManageUsers(user);
}
