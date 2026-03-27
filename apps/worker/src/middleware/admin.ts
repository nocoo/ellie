// Admin role guard middleware for Cloudflare Worker
import { UserRole } from "@ellie/types";
import type { AuthUser } from "./auth";
import { errorResponse } from "./error";

/**
 * Guard: requires Admin role.
 * Returns null if authorized, or a 403 Response if not.
 */
export function requireAdmin(user: AuthUser, origin?: string): Response | null {
	if (user.role !== UserRole.Admin) {
		return errorResponse("FORBIDDEN_ADMIN_ONLY", 403, undefined, origin);
	}
	return null;
}

/**
 * Guard: requires Moderator-level access (Admin, SuperMod, or Mod).
 * Returns null if authorized, or a 403 Response if not.
 */
export function requireModerator(user: AuthUser, origin?: string): Response | null {
	if (
		user.role !== UserRole.Admin &&
		user.role !== UserRole.SuperMod &&
		user.role !== UserRole.Mod
	) {
		return errorResponse("FORBIDDEN_MOD_ONLY", 403, undefined, origin);
	}
	return null;
}
