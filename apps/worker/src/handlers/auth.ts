// Auth handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { createJwt } from "../lib/jwt";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../lib/password";
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
	try {
		const { username, password } = (await request.json()) as LoginInput;

		if (!username || !password) {
			return errorResponse("INVALID_REQUEST", 400, {
				message: "username and password are required",
			});
		}

		// Query user from D1
		const stmt = env.DB.prepare(
			"SELECT id, username, password_hash, password_salt, role, status FROM users WHERE username = ?",
		);
		const result = await stmt.bind(username).first();

		if (!result) {
			return errorResponse("INVALID_CREDENTIALS", 401);
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
			return errorResponse("USER_BANNED", 403);
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
			return errorResponse("INVALID_CREDENTIALS", 401);
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
				headers: { ...corsHeaders(), "Content-Type": "application/json" },
			},
		);
	} catch {
		return errorResponse("INTERNAL_ERROR", 500);
	}
}
