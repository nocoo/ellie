// Admin helpers — unified adminAuth entry point and route wrappers
// All /api/admin/* routes go through adminAuth() for authentication,
// then the entity's auth config determines the required role level.

import { requireAdmin, requireModerator } from "../middleware/admin";
import type { AuthUser } from "../middleware/auth";
import { authMiddleware } from "../middleware/auth";
import type { EntityConfig } from "./crud";
import type { Env } from "./env";

/**
 * Unified admin authentication entry point.
 * All /api/admin/* routes call this single function.
 *
 * Returns the authenticated user or an error Response.
 */
export async function adminAuth(
	request: Request,
	env: Env,
): Promise<{ user: AuthUser } | Response> {
	const authResult = await authMiddleware(request, env);
	if (authResult instanceof Response) return authResult;
	return authResult;
}

/**
 * Wraps an admin handler with unified adminAuth + role check based on EntityConfig.
 * Handlers receive the already-authenticated user — no auth code inside handlers.
 */
export function withEntityAuth(
	config: EntityConfig,
	handler: (request: Request, env: Env, user: AuthUser) => Promise<Response>,
) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		// Unified auth entry
		const authResult = await adminAuth(request, env);
		if (authResult instanceof Response) return authResult;
		const { user } = authResult;

		// Role check based on entity config
		if (config.auth === "admin") {
			const roleCheck = requireAdmin(user, origin);
			if (roleCheck) return roleCheck;
		} else if (config.auth === "moderator") {
			const roleCheck = requireModerator(user, origin);
			if (roleCheck) return roleCheck;
		}

		return handler(request, env, user);
	};
}

/**
 * Creates a full set of CRUD route handlers for an entity,
 * each wrapped with the appropriate auth.
 */
export function createEntityHandlers(
	config: EntityConfig,
	handlers: Record<string, (request: Request, env: Env, user: AuthUser) => Promise<Response>>,
): Record<string, (request: Request, env: Env) => Promise<Response>> {
	const wrapped: Record<string, (request: Request, env: Env) => Promise<Response>> = {};
	for (const [name, handler] of Object.entries(handlers)) {
		wrapped[name] = withEntityAuth(config, handler);
	}
	return wrapped;
}
