// JWT authentication middleware for Cloudflare Worker
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
