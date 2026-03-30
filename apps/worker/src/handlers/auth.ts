// Auth handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { createJwt } from "../lib/jwt";
import { toUser } from "../lib/mappers";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../lib/password";
import { jsonResponse } from "../lib/response";
import { withAuth } from "../lib/routeHelpers";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

interface LoginInput {
	username: string;
	password: string;
}

interface AuthUser {
	userId: number;
	username: string;
	role: number;
}

/** POST /api/v1/auth/login - Login with password upgrade */
export async function login(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	try {
		const { username, password } = (await request.json()) as LoginInput;

		if (!username || !password) {
			return errorResponse(
				"INVALID_REQUEST",
				400,
				{ message: "username and password are required" },
				origin,
			);
		}

		// Query user from D1
		const stmt = env.DB.prepare(
			"SELECT id, username, password_hash, password_salt, role, status FROM users WHERE username = ?",
		);
		const result = await stmt.bind(username).first();

		if (!result) {
			return errorResponse("INVALID_CREDENTIALS", 401, undefined, origin);
		}

		const user = result as {
			id: number;
			username: string;
			password_hash: string;
			password_salt: string;
			role: number;
			status: number;
		};

		// Check if user is banned
		if (user.status !== 0) {
			return errorResponse("USER_BANNED", 403, undefined, origin);
		}

		// Verify password (support both Discuz and PBKDF2 formats)
		let isValid = false;
		if (user.password_salt) {
			// Old Discuz format: md5(md5(password) + salt)
			isValid = await verifyDiscuzPassword(password, user.password_hash, user.password_salt);
		} else {
			// New PBKDF2 format
			isValid = await verifyPassword(password, user.password_hash);
		}

		if (!isValid) {
			return errorResponse("INVALID_CREDENTIALS", 401, undefined, origin);
		}

		// Generate JWT token (7 days)
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const token = await createJwt(
			{
				userId: user.id,
				role: user.role,
				exp,
			},
			env.JWT_SECRET,
		);

		// Generate refresh token (random UUID)
		const refreshToken = crypto.randomUUID();

		// Store refresh token in KV (30 days)
		await env.KV.put(`refresh:${refreshToken}`, String(user.id), {
			expirationTtl: 30 * 24 * 60 * 60,
		});

		// Silent password upgrade if still using old format
		if (user.password_salt) {
			const newHash = await hashPassword(password);
			await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = '' WHERE id = ?")
				.bind(newHash, user.id)
				.run();
		}

		// Update last login time
		await env.DB.prepare("UPDATE users SET last_login = ? WHERE id = ?")
			.bind(Math.floor(Date.now() / 1000), user.id)
			.run();

		return new Response(
			JSON.stringify({
				data: {
					token,
					refreshToken,
					user: {
						userId: user.id,
						username: user.username,
						role: user.role,
					} satisfies AuthUser,
				},
				meta: {
					timestamp: Date.now(),
					requestId: crypto.randomUUID(),
				},
			}),
			{
				headers: {
					...corsHeaders(origin),
					"Content-Type": "application/json",
				},
			},
		);
	} catch {
		return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
	}
}

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits, signature";

/** POST /api/v1/auth/refresh - Exchange refresh token for new JWT + rotated refresh token */
export async function refresh(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const refreshToken = body.refreshToken;

		if (typeof refreshToken !== "string" || refreshToken.length === 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "refreshToken is required" }, origin);
		}

		// Look up refresh token in KV
		const userId = await env.KV.get(`refresh:${refreshToken}`);
		if (!userId) {
			return errorResponse("INVALID_REFRESH_TOKEN", 401, undefined, origin);
		}

		// Fetch user from D1
		const userIdNum = Number.parseInt(userId, 10);
		const row = await env.DB.prepare("SELECT id, username, role, status FROM users WHERE id = ?")
			.bind(userIdNum)
			.first();

		if (!row) {
			// User deleted — clean up orphan token
			await env.KV.delete(`refresh:${refreshToken}`);
			return errorResponse("INVALID_REFRESH_TOKEN", 401, undefined, origin);
		}

		const user = row as { id: number; username: string; role: number; status: number };

		// Check if user is banned
		if (user.status !== 0) {
			await env.KV.delete(`refresh:${refreshToken}`);
			return errorResponse("USER_BANNED", 403, undefined, origin);
		}

		// Rotate: delete old refresh token, create new one
		await env.KV.delete(`refresh:${refreshToken}`);

		const newRefreshToken = crypto.randomUUID();
		await env.KV.put(`refresh:${newRefreshToken}`, String(user.id), {
			expirationTtl: 30 * 24 * 60 * 60,
		});

		// Generate new JWT (7 days)
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const token = await createJwt({ userId: user.id, role: user.role, exp }, env.JWT_SECRET);

		return new Response(
			JSON.stringify({
				data: {
					token,
					refreshToken: newRefreshToken,
					user: {
						userId: user.id,
						username: user.username,
						role: user.role,
					} satisfies AuthUser,
				},
				meta: {
					timestamp: Date.now(),
					requestId: crypto.randomUUID(),
				},
			}),
			{
				headers: {
					...corsHeaders(origin),
					"Content-Type": "application/json",
				},
			},
		);
	} catch {
		return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
	}
}

/** DELETE /api/v1/auth/logout - Invalidate refresh token */
export async function logout(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	try {
		const body = (await request.json()) as Record<string, unknown>;
		const refreshToken = body.refreshToken;

		if (typeof refreshToken !== "string" || refreshToken.length === 0) {
			return errorResponse("INVALID_REQUEST", 400, { message: "refreshToken is required" }, origin);
		}

		// Delete refresh token from KV (fire-and-forget, always succeeds)
		await env.KV.delete(`refresh:${refreshToken}`);

		return jsonResponse({ loggedOut: true }, origin);
	} catch {
		return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
	}
}

/** GET /api/v1/auth/me - Get current user profile */
export const me = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	const row = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(user.userId)
		.first();

	if (!row) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toUser(row as Record<string, unknown>), origin);
});
