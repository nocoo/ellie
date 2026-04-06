// Maintenance mode middleware — blocks public requests when maintenance mode is enabled
// Allows: admin routes, auth routes, settings endpoint, health check, forum admins

import { UserRole } from "@ellie/types";
import type { Env } from "../lib/env";
import { isTokenExpired, verifyJwt } from "../lib/jwt";
import { getSetting } from "../lib/settings";
import { errorResponse } from "./error";

/** Paths that bypass maintenance mode */
const BYPASS_PREFIXES = [
	"/api/live", // Health check
	"/api/admin/", // Admin routes (require admin auth anyway)
	"/api/v1/auth/login", // Login only
	"/api/v1/auth/logout", // Logout
	"/api/v1/auth/refresh", // Token refresh
	"/api/v1/auth/me", // Current user check
	// Note: /register and /check-username are NOT bypassed during maintenance
	"/api/v1/settings", // Settings endpoint (needed to check maintenance status)
];

/**
 * Check if maintenance mode is enabled and block non-admin requests.
 * Returns null if request should proceed, Response if blocked.
 */
export async function checkMaintenance(
	request: Request,
	env: Env,
	origin?: string,
): Promise<Response | null> {
	const url = new URL(request.url);
	const path = url.pathname;

	// Allow bypass paths
	if (BYPASS_PREFIXES.some((prefix) => path.startsWith(prefix))) {
		return null;
	}

	// Check maintenance mode setting
	const isMaintenanceMode = await getSetting(env, "features.access.maintenance_mode", false);
	if (!isMaintenanceMode) {
		return null;
	}

	// Check if admin bypass is enabled
	const adminBypass = await getSetting(env, "features.access.maintenance_admin_bypass", false);
	if (adminBypass) {
		// Check if user is a forum admin (role = 1) via JWT
		const isForumAdmin = await checkForumAdmin(request, env);
		if (isForumAdmin) {
			return null;
		}
	}

	// Get custom maintenance message
	const message = await getSetting(
		env,
		"features.access.maintenance_message",
		"系统维护中，请稍后再试...",
	);

	return errorResponse("MAINTENANCE_MODE", 503, { message }, origin);
}

/**
 * Check if request has a valid JWT with admin role, verified against DB.
 * Verifies both JWT validity AND current DB role/status to prevent
 * demoted or banned admins from bypassing maintenance.
 */
async function checkForumAdmin(request: Request, env: Env): Promise<boolean> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return false;
	}

	try {
		const token = authHeader.slice(7);
		const payload = (await verifyJwt(token, env.JWT_SECRET)) as {
			userId: number;
			role: number;
			exp: number;
		};

		if (isTokenExpired(payload)) {
			return false;
		}

		// Quick check: JWT claims admin role
		if (payload.role !== UserRole.Admin) {
			return false;
		}

		// DB verification: confirm current role and status
		// Prevents demoted/banned admins with old tokens from bypassing
		const user = await env.DB.prepare("SELECT role, status FROM users WHERE id = ?")
			.bind(payload.userId)
			.first<{ role: number; status: number }>();

		if (!user) {
			return false;
		}

		// Must be active admin (status >= 0 means not banned/archived/placeholder)
		return user.role === UserRole.Admin && user.status >= 0;
	} catch {
		return false;
	}
}
