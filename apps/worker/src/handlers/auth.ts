// Auth handlers for Cloudflare Worker
import { checkCensorWords } from "../lib/censor";
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

		// ── Rate limiting: 5 attempts per hour per IP, lockout 24h after 5 consecutive failures ──
		// NOTE: Only IP-based rate limiting to prevent DoS via username lockout attacks
		const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";

		// Check for 24-hour lockout first
		const ipLockoutKey = `login-lockout-ip:${ip}`;
		const ipLocked = await env.KV.get(ipLockoutKey);

		if (ipLocked) {
			return errorResponse(
				"RATE_LIMITED",
				429,
				{ message: "Too many failed attempts. Try again later." },
				origin,
			);
		}

		// Check hourly rate limit (5 attempts per hour per IP)
		const ipRateLimitKey = `login-ip:${ip}`;
		const ipAttemptsStr = await env.KV.get(ipRateLimitKey);
		const ipAttempts = Number.parseInt(ipAttemptsStr ?? "0", 10);

		if (ipAttempts >= 5) {
			// Trigger 24-hour lockout for this IP
			await env.KV.put(ipLockoutKey, "1", { expirationTtl: 24 * 60 * 60 });
			return errorResponse(
				"RATE_LIMITED",
				429,
				{ message: "Too many failed attempts. Try again in 24 hours." },
				origin,
			);
		}

		// Query user from D1
		const stmt = env.DB.prepare(
			"SELECT id, username, password_hash, password_salt, role, status FROM users WHERE username = ?",
		);
		const result = await stmt.bind(username).first();

		if (!result) {
			// Increment rate limit counter on invalid username
			await env.KV.put(ipRateLimitKey, String(ipAttempts + 1), { expirationTtl: 3600 });
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
			// Increment rate limit counter on failed password verification
			await env.KV.put(ipRateLimitKey, String(ipAttempts + 1), { expirationTtl: 3600 });
			return errorResponse("INVALID_CREDENTIALS", 401, undefined, origin);
		}

		// Login successful — clear rate limit counter
		await env.KV.delete(ipRateLimitKey);

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
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity";

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

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Validate username format: 2-15 chars, Chinese/English/digits/underscore */
const USERNAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_]{2,15}$/;

/** Validate email format (loose) */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RegisterInput {
	username: string;
	password: string;
	email?: string;
}

/** POST /api/v1/auth/register - Register a new forum user */
export async function register(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	try {
		const body = (await request.json()) as RegisterInput;
		const username = typeof body.username === "string" ? body.username.trim() : "";
		const password = typeof body.password === "string" ? body.password : "";
		const email = typeof body.email === "string" ? body.email.trim() : "";

		// ── Input validation (before any DB calls for efficiency) ──
		if (!username || !USERNAME_REGEX.test(username)) {
			return errorResponse("INVALID_USERNAME", 400, undefined, origin);
		}

		if (!password || password.length < 6) {
			return errorResponse("INVALID_PASSWORD", 400, undefined, origin);
		}

		if (email && !EMAIL_REGEX.test(email)) {
			return errorResponse("INVALID_EMAIL", 400, undefined, origin);
		}

		// ── Check if registration is allowed ──
		const registrationSetting = await env.DB.prepare(
			"SELECT value FROM settings WHERE key = 'features.registration.allow_new_user'",
		).first<{ value: string }>();

		// Default to true if setting doesn't exist
		const allowRegistration = registrationSetting?.value !== "false";
		if (!allowRegistration) {
			return errorResponse("REGISTRATION_DISABLED", 403, undefined, origin);
		}

		// ── Censor word check on username ──
		const censorResult = await checkCensorWords(username, env);
		if (censorResult.matched && censorResult.action === "ban") {
			return errorResponse("USERNAME_BANNED", 400, undefined, origin);
		}

		// ── IP rate limiting: max 3 registrations per hour ──
		const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
		const rateLimitKey = `reg-ip:${ip}`;
		const currentCount = Number.parseInt((await env.KV.get(rateLimitKey)) ?? "0", 10);
		if (currentCount >= 3) {
			return errorResponse("RATE_LIMITED", 429, undefined, origin);
		}

		// ── Hash password (PBKDF2-SHA256) ──
		const passwordHash = await hashPassword(password);
		const now = Math.floor(Date.now() / 1000);

		// ── Insert user (UNIQUE constraint safety net) ──
		try {
			await env.DB.prepare(
				`INSERT INTO users (
					username, email, password_hash, password_salt,
					status, role, reg_date, last_login, last_activity,
					group_title, group_stars
				) VALUES (?, ?, ?, '', 0, 0, ?, ?, ?, '新手上路', 0)`,
			)
				.bind(username, email, passwordHash, now, now, now)
				.run();
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
				return errorResponse("USERNAME_TAKEN", 409, undefined, origin);
			}
			throw e;
		}

		// ── Get inserted user ID ──
		const inserted = await env.DB.prepare("SELECT id FROM users WHERE username = ?")
			.bind(username)
			.first();

		if (!inserted) {
			return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
		}

		const userId = (inserted as { id: number }).id;

		// ── Issue JWT + refresh token (same as login) ──
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const token = await createJwt({ userId, role: 0, exp }, env.JWT_SECRET);

		const refreshToken = crypto.randomUUID();
		await env.KV.put(`refresh:${refreshToken}`, String(userId), {
			expirationTtl: 30 * 24 * 60 * 60,
		});

		// ── Increment IP rate limit counter ──
		await env.KV.put(rateLimitKey, String(currentCount + 1), {
			expirationTtl: 3600,
		});

		return new Response(
			JSON.stringify({
				data: {
					token,
					refreshToken,
					user: { userId, username, role: 0 } satisfies AuthUser,
				},
				meta: {
					timestamp: Date.now(),
					requestId: crypto.randomUUID(),
				},
			}),
			{
				status: 201,
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

/** GET /api/v1/auth/check-username - Check username availability */
export async function checkUsername(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const username = url.searchParams.get("username")?.trim() ?? "";

	// Format validation (no rate-limit cost for missing/invalid param)
	if (!username || !USERNAME_REGEX.test(username)) {
		return jsonResponse({ available: false, reason: "invalid" }, origin);
	}

	// ── IP rate limiting: max 30 checks per minute ──
	const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
	const rateLimitKey = `chk-usr-ip:${ip}`;
	const currentCount = Number.parseInt((await env.KV.get(rateLimitKey)) ?? "0", 10);
	if (currentCount >= 30) {
		return errorResponse("RATE_LIMITED", 429, undefined, origin);
	}

	// Censor word check
	const censorResult = await checkCensorWords(username, env);
	if (censorResult.matched && censorResult.action === "ban") {
		await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });
		return jsonResponse({ available: false, reason: "banned" }, origin);
	}

	// Database uniqueness check
	const existing = await env.DB.prepare("SELECT 1 FROM users WHERE username = ?")
		.bind(username)
		.first();

	if (existing) {
		await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });
		return jsonResponse({ available: false, reason: "taken" }, origin);
	}

	await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });
	return jsonResponse({ available: true }, origin);
}
