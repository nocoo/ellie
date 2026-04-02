// Maintenance mode middleware — blocks public requests when maintenance mode is enabled
// Allows: admin routes, auth routes, settings endpoint, health check

import type { Env } from "../lib/env";
import { getSetting } from "../lib/settings";
import { errorResponse } from "./error";

/** Paths that bypass maintenance mode */
const BYPASS_PREFIXES = [
	"/api/live", // Health check
	"/api/admin/", // Admin routes (require admin auth anyway)
	"/api/v1/auth/", // Auth routes (login/logout/refresh)
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

	// Get custom maintenance message
	const message = await getSetting(
		env,
		"features.access.maintenance_message",
		"系统维护中，请稍后再试...",
	);

	return errorResponse("MAINTENANCE_MODE", 503, { message }, origin);
}
