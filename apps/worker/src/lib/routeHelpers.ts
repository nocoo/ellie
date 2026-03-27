// Route helper wrappers — withAuth / withAdmin / withModerator
// Eliminates auth boilerplate from every admin handler.

import { requireAdmin, requireModerator } from "../middleware/admin";
import type { AuthUser } from "../middleware/auth";
import { authMiddleware } from "../middleware/auth";
import type { Env } from "./env";

/** Handler that receives an authenticated user */
export type AuthenticatedHandler = (
	request: Request,
	env: Env,
	user: AuthUser,
) => Promise<Response>;

/**
 * Wrap a handler with JWT authentication.
 * The inner handler receives the authenticated AuthUser.
 */
export function withAuth(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const authResult = await authMiddleware(request, env);
		if (authResult instanceof Response) return authResult;
		return handler(request, env, authResult.user);
	};
}

/**
 * Wrap a handler with JWT authentication + Admin role check.
 */
export function withAdmin(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const authResult = await authMiddleware(request, env);
		if (authResult instanceof Response) return authResult;
		const roleCheck = requireAdmin(authResult.user, origin);
		if (roleCheck) return roleCheck;
		return handler(request, env, authResult.user);
	};
}

/**
 * Wrap a handler with JWT authentication + Moderator role check.
 */
export function withModerator(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const authResult = await authMiddleware(request, env);
		if (authResult instanceof Response) return authResult;
		const roleCheck = requireModerator(authResult.user, origin);
		if (roleCheck) return roleCheck;
		return handler(request, env, authResult.user);
	};
}
