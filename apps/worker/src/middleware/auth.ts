// JWT authentication middleware for Cloudflare Worker
import { UserRole } from "@ellie/types";
import type { Env } from "../lib/env";
import { isTokenExpired, verifyJwt } from "../lib/jwt";
import { errorResponse } from "./error";

export interface JwtPayload {
	userId: number;
	role: number;
	exp: number;
}

export interface AuthUser {
	userId: number;
	role: number;
}

/**
 * Optional JWT authentication — extracts user info if valid token present.
 * Does NOT reject requests without auth, returns null instead.
 * Used for endpoints that have different behavior for logged-in users.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns AuthUser if valid token, null otherwise
 */
export async function optionalAuth(request: Request, env: Env): Promise<AuthUser | null> {
	const authHeader = request.headers.get("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return null;
	}

	const token = authHeader.slice(7);
	try {
		const payload = (await verifyJwt(token, env.JWT_SECRET)) as JwtPayload;
		if (isTokenExpired(payload)) {
			return null;
		}
		return { userId: payload.userId, role: payload.role };
	} catch {
		return null;
	}
}

/**
 * JWT authentication middleware.
 * Verifies JWT token from Authorization header and returns authenticated user.
 *
 * @param request - Incoming request
 * @param env - Worker environment
 * @returns Either { user: AuthUser } or error Response
 */
export async function authMiddleware(
	request: Request,
	env: Env,
): Promise<{ user: AuthUser } | Response> {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader?.startsWith("Bearer ")) {
		return errorResponse("UNAUTHORIZED", 401);
	}

	const token = authHeader.slice(7);

	try {
		const payload = (await verifyJwt(token, env.JWT_SECRET)) as JwtPayload;

		// Check expiration
		if (isTokenExpired(payload)) {
			return errorResponse("TOKEN_EXPIRED", 401);
		}

		return {
			user: {
				userId: payload.userId,
				role: payload.role,
			},
		};
	} catch {
		return errorResponse("INVALID_TOKEN", 401);
	}
}

/**
 * Moderation middleware — JWT auth + role check for /api/v1/moderation/* endpoints.
 * Requires any non-User role: Admin (1), SuperMod (2), or Mod (3).
 * Used by forum moderators in the web frontend (Key A + JWT).
 *
 * IMPORTANT: This middleware performs a database lookup to verify the user's current role,
 * preventing privilege escalation from cached JWT claims after role demotion.
 */
export async function moderationMiddleware(
	request: Request,
	env: Env,
): Promise<{ user: AuthUser } | Response> {
	const authResult = await authMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const { user } = authResult;

	// Verify current role from database (not just JWT claims)
	// This prevents demoted users from using cached JWT privileges
	const dbUser = await env.DB.prepare("SELECT role, status FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ role: number; status: number }>();

	if (!dbUser) {
		return errorResponse("USER_NOT_FOUND", 404);
	}

	// Check if user is banned
	if (dbUser.status !== 0) {
		return errorResponse("USER_BANNED", 403);
	}

	// Use database role instead of JWT claim
	const currentRole = dbUser.role;

	// Mod (3), SuperMod (2), Admin (1) can perform moderation actions
	if (currentRole === UserRole.User) {
		return errorResponse("FORBIDDEN_MOD_ONLY", 403);
	}

	// Return user with verified role from database
	return { user: { userId: user.userId, role: currentRole } };
}
