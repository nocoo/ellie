// Route helper wrappers — withAuth / withAuthVerified / withAdmin / withModerator
// Eliminates auth boilerplate from every admin handler.

import { UserRole } from "@ellie/types";
import type { AuthUser } from "../middleware/auth";
import { authMiddleware, authMiddlewareVerified, requireVerifiedEmail } from "../middleware/auth";
import { errorResponse } from "../middleware/error";
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
 *
 * NOTE: This version trusts JWT claims without database verification.
 * For sensitive endpoints, use withAuthVerified instead.
 */
export function withAuth(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const authResult = await authMiddleware(request, env);
		if (authResult instanceof Response) return authResult;
		return handler(request, env, authResult.user);
	};
}

/**
 * Wrap a handler with JWT authentication + database verification.
 * Verifies current status and role from database before calling handler.
 * Banned users are rejected even if their JWT is still valid.
 *
 * Use this for sensitive endpoints (messages, profile edit, password change, content deletion).
 */
export function withAuthVerified(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const authResult = await authMiddlewareVerified(request, env);
		if (authResult instanceof Response) return authResult;
		return handler(request, env, authResult.user);
	};
}

/**
 * Wrap a handler with JWT auth + DB verification + email-verified gate.
 *
 * Equivalent to {@link withAuthVerified} but additionally rejects users whose
 * email is unverified with `403 EMAIL_NOT_VERIFIED`. Banned users still
 * surface as `403 USER_BANNED` (see {@link requireVerifiedEmail} precedence).
 *
 * Use this for endpoints that mutate forum content (post create / reply /
 * thread create / attachment upload, etc.) per docs/17 §5 Read-only gate.
 */
export function withVerifiedEmail(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const authResult = await requireVerifiedEmail(request, env);
		if (authResult instanceof Response) return authResult;
		return handler(request, env, authResult.user);
	};
}

/**
 * Verify user's current role from database.
 * Returns AuthUser with verified role, or error Response.
 *
 * IMPORTANT: This performs a database lookup to prevent privilege escalation
 * from cached JWT claims after role demotion.
 */
async function verifyUserRole(
	userId: number,
	env: Env,
	origin?: string,
): Promise<{ user: AuthUser } | Response> {
	const dbUser = await env.DB.prepare("SELECT role, status FROM users WHERE id = ?")
		.bind(userId)
		.first<{ role: number; status: number }>();

	if (!dbUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	if (dbUser.status !== 0) {
		return errorResponse("USER_BANNED", 403, undefined, origin);
	}

	return { user: { userId, role: dbUser.role } };
}

/**
 * Wrap a handler with JWT authentication + Admin role check.
 * Performs database lookup to verify current role.
 */
export function withAdmin(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const authResult = await authMiddleware(request, env);
		if (authResult instanceof Response) return authResult;

		// Verify current role from database
		const verifyResult = await verifyUserRole(authResult.user.userId, env, origin);
		if (verifyResult instanceof Response) return verifyResult;

		const { user } = verifyResult;
		if (user.role !== UserRole.Admin) {
			return errorResponse("FORBIDDEN_ADMIN_ONLY", 403, undefined, origin);
		}

		return handler(request, env, user);
	};
}

/**
 * Wrap a handler with JWT authentication + Moderator role check.
 * Performs database lookup to verify current role.
 */
export function withModerator(handler: AuthenticatedHandler) {
	return async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const authResult = await authMiddleware(request, env);
		if (authResult instanceof Response) return authResult;

		// Verify current role from database
		const verifyResult = await verifyUserRole(authResult.user.userId, env, origin);
		if (verifyResult instanceof Response) return verifyResult;

		const { user } = verifyResult;
		if (
			user.role !== UserRole.Admin &&
			user.role !== UserRole.SuperMod &&
			user.role !== UserRole.Mod
		) {
			return errorResponse("FORBIDDEN_MOD_ONLY", 403, undefined, origin);
		}

		return handler(request, env, user);
	};
}
