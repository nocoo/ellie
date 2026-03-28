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
 */
export async function moderationMiddleware(
	request: Request,
	env: Env,
): Promise<{ user: AuthUser } | Response> {
	const authResult = await authMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const { user } = authResult;
	// Mod (3), SuperMod (2), Admin (1) can perform moderation actions
	if (user.role === UserRole.User) {
		return errorResponse("FORBIDDEN_MOD_ONLY", 403);
	}

	return { user };
}
