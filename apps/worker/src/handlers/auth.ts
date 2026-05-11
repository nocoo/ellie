// Auth handlers for Cloudflare Worker
import { checkCensorWords } from "../lib/censor";
import type { Env } from "../lib/env";
import { createJwt } from "../lib/jwt";
import { toUser } from "../lib/mappers";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../lib/password";
import { jsonResponse } from "../lib/response";
import { withAuthVerified } from "../lib/routeHelpers";
import { errorResponse } from "../middleware/error";
import { DB_COLUMNS, validateProfileFields } from "./me";

/**
 * Get client IP from request headers.
 *
 * Priority:
 * 1. CF-Connecting-IP - Cloudflare sets this for direct requests to Worker (cannot be spoofed)
 * 2. X-Real-IP - Next.js proxy forwards this from Vercel's x-real-ip header
 *
 * SECURITY: We do NOT trust X-Forwarded-For because it can be spoofed by clients.
 * - CF-Connecting-IP is set by Cloudflare and cannot be spoofed
 * - X-Real-IP is set by our Next.js proxy from Vercel's trusted x-real-ip
 * - X-Forwarded-For can contain spoofed values prepended by malicious clients
 *
 * Returns null if no valid IP found (should reject request to prevent rate limit bypass).
 */
function getClientIP(request: Request): string | null {
	// Direct Cloudflare access - always trustworthy
	const cfIP = request.headers.get("CF-Connecting-IP");
	if (cfIP) return cfIP;

	// Next.js proxy forwarding client IP from Vercel's x-real-ip
	// This is set by our trusted server, not by the client
	const realIP = request.headers.get("X-Real-IP");
	if (realIP) return realIP;

	// Do NOT fall back to X-Forwarded-For as it can be spoofed
	return null;
}

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
		const ip = getClientIP(request);
		if (!ip) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Missing client IP" }, origin);
		}

		const ipLockoutKey = `login-lockout-ip:${ip}`;
		const ipRateLimitKey = `login-ip:${ip}`;

		// Lockout check + hourly rate-limit + user fetch are all independent
		// reads. Fan them out so the slowest dominates instead of summing the
		// three round-trips.
		const [ipLocked, ipAttemptsStr, result] = await Promise.all([
			env.KV.get(ipLockoutKey),
			env.KV.get(ipRateLimitKey),
			env.DB.prepare(
				"SELECT id, username, password_hash, password_salt, role, status FROM users WHERE username = ?",
			)
				.bind(username)
				.first(),
		]);

		if (ipLocked) {
			return errorResponse(
				"RATE_LIMITED",
				429,
				{ message: "Too many failed attempts. Try again later." },
				origin,
			);
		}

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

		// Login successful — fan out the post-verify side effects in parallel:
		//   - clear rate-limit counter (KV)
		//   - sign JWT (CPU)
		//   - persist refresh token (KV)
		//   - update last_login + last_ip (D1)
		//   - (optional) silent password upgrade for legacy Discuz users (D1)
		// They're all independent and don't gate the response shape.
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const refreshToken = crypto.randomUUID();

		const sideEffects: Promise<unknown>[] = [
			env.KV.delete(ipRateLimitKey),
			env.KV.put(`refresh:${refreshToken}`, String(user.id), {
				expirationTtl: 30 * 24 * 60 * 60,
			}),
			env.DB.prepare("UPDATE users SET last_login = ?, last_ip = ? WHERE id = ?")
				.bind(Math.floor(Date.now() / 1000), ip, user.id)
				.run(),
		];
		if (user.password_salt) {
			sideEffects.push(
				hashPassword(password).then((newHash) =>
					env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = '' WHERE id = ?")
						.bind(newHash, user.id)
						.run(),
				),
			);
		}
		const tokenPromise = createJwt(
			{
				userId: user.id,
				role: user.role,
				exp,
			},
			env.JWT_SECRET,
		);
		const [token] = await Promise.all([tokenPromise, ...sideEffects]);

		return jsonResponse(
			{
				token,
				refreshToken,
				user: {
					userId: user.id,
					username: user.username,
					role: user.role,
				} satisfies AuthUser,
			},
			origin,
		);
	} catch {
		return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
	}
}

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, avatar_path, status, role, reg_date, last_login, threads, posts, credits, coins, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, campus, last_activity, email_verified_at, email_normalized, email_changed_at";

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

		// Rotate: delete old refresh token + create new one + sign JWT in
		// parallel — the three operations are independent of each other.
		const newRefreshToken = crypto.randomUUID();
		const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
		const [, , token] = await Promise.all([
			env.KV.delete(`refresh:${refreshToken}`),
			env.KV.put(`refresh:${newRefreshToken}`, String(user.id), {
				expirationTtl: 30 * 24 * 60 * 60,
			}),
			createJwt({ userId: user.id, role: user.role, exp }, env.JWT_SECRET),
		]);

		return jsonResponse(
			{
				token,
				refreshToken: newRefreshToken,
				user: {
					userId: user.id,
					username: user.username,
					role: user.role,
				} satisfies AuthUser,
			},
			origin,
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
export const me = withAuthVerified(async (request, env, user) => {
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
	email: string;
	/** Optional profile fields — validated via shared validateProfileFields */
	profile?: Record<string, unknown>;
}

/** Extract and validate core register fields. Returns parsed values or error Response. */
function parseRegisterInput(
	body: RegisterInput,
	origin: string | undefined,
): { username: string; password: string; email: string } | Response {
	const username = typeof body.username === "string" ? body.username.trim() : "";
	const password = typeof body.password === "string" ? body.password : "";
	const email = typeof body.email === "string" ? body.email.trim() : "";

	if (!username || !USERNAME_REGEX.test(username)) {
		return errorResponse("INVALID_USERNAME", 400, undefined, origin);
	}
	if (!password || password.length < 6) {
		return errorResponse("INVALID_PASSWORD", 400, undefined, origin);
	}
	if (!email || !EMAIL_REGEX.test(email)) {
		return errorResponse("INVALID_EMAIL", 400, undefined, origin);
	}

	return { username, password, email };
}

/** Build INSERT columns + params for a new user, merging base fields with optional profile fields. */
function buildInsertQuery(
	base: { username: string; email: string; passwordHash: string; ip: string; now: number },
	profileFields: Record<string, unknown>,
): { sql: string; params: unknown[] } {
	const baseColumns = [
		"username",
		"email",
		"password_hash",
		"password_salt",
		"status",
		"role",
		"reg_date",
		"last_login",
		"last_activity",
		"group_title",
		"group_stars",
		"reg_ip",
		"last_ip",
	];
	const baseParams: unknown[] = [
		base.username,
		base.email,
		base.passwordHash,
		"",
		0,
		0,
		base.now,
		base.now,
		base.now,
		"新手上路",
		0,
		base.ip,
		base.ip,
	];

	const profileColumns: string[] = [];
	const profileParams: unknown[] = [];
	for (const [key, value] of Object.entries(profileFields)) {
		if (value !== undefined && DB_COLUMNS[key]) {
			profileColumns.push(DB_COLUMNS[key]);
			profileParams.push(value);
		}
	}

	const allColumns = [...baseColumns, ...profileColumns];
	const allParams = [...baseParams, ...profileParams];
	const placeholders = allColumns.map(() => "?").join(", ");

	return {
		sql: `INSERT INTO users (${allColumns.join(", ")}) VALUES (${placeholders})`,
		params: allParams,
	};
}

/** POST /api/v1/auth/register - Register a new forum user */
export async function register(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	try {
		const body = (await request.json()) as RegisterInput;

		// ── Input validation (before any DB calls for efficiency) ──
		const parsed = parseRegisterInput(body, origin);
		if (parsed instanceof Response) return parsed;
		const { username, password, email } = parsed;

		// ── Validate profile fields (education fields required at registration) ──
		let profileFields: Record<string, unknown> = {};
		if (body.profile && typeof body.profile === "object") {
			// Strip email and avatar from profile to avoid double-handling
			const { email: _e, avatar: _a, ...profileBody } = body.profile;
			const validation = validateProfileFields(
				profileBody,
				origin,
				true, // skipEmptyCheck — individual field presence checked below
			);
			if (!validation.success) {
				return validation.error;
			}
			profileFields = validation.fields;
		}

		// Education fields are required at registration (not for PATCH /users/me)
		const gs = profileFields.graduateSchool;
		if (!gs || (typeof gs === "string" && !gs.trim())) {
			return errorResponse("INVALID_BODY", 400, { message: "Identity type is required" }, origin);
		}
		const camp = profileFields.campus;
		if (!camp || (typeof camp === "string" && !camp.trim())) {
			return errorResponse("INVALID_BODY", 400, { message: "Campus is required" }, origin);
		}

		// Independent guards: settings lookup + censor check + IP rate-limit
		// counter. Run them in parallel — saves up to 2 D1/KV round-trips on
		// the registration hot path.
		const ip = getClientIP(request);
		if (!ip) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Missing client IP" }, origin);
		}
		const rateLimitKey = `reg-ip:${ip}`;

		const [registrationSetting, censorResult, rateCountRaw] = await Promise.all([
			env.DB.prepare(
				"SELECT value FROM settings WHERE key = 'features.registration.allow_new_user'",
			).first<{ value: string }>(),
			checkCensorWords(username, env),
			env.KV.get(rateLimitKey),
		]);

		// Default to true if setting doesn't exist
		const allowRegistration = registrationSetting?.value !== "false";
		if (!allowRegistration) {
			return errorResponse("REGISTRATION_DISABLED", 403, undefined, origin);
		}

		if (censorResult.matched && censorResult.action === "ban") {
			return errorResponse("USERNAME_BANNED", 400, undefined, origin);
		}

		const currentCount = Number.parseInt(rateCountRaw ?? "0", 10);
		if (currentCount >= 3) {
			return errorResponse("RATE_LIMITED", 429, undefined, origin);
		}

		// ── Hash password (PBKDF2-SHA256) ──
		const passwordHash = await hashPassword(password);
		const now = Math.floor(Date.now() / 1000);

		// ── Build & execute INSERT ──
		const { sql, params } = buildInsertQuery(
			{ username, email, passwordHash, ip, now },
			profileFields,
		);

		let userId: number;
		try {
			const insertResult = await env.DB.prepare(sql)
				.bind(...params)
				.run();
			userId = Number(insertResult.meta.last_row_id);
			if (!userId) {
				return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("UNIQUE constraint")) {
				return errorResponse("USERNAME_TAKEN", 409, undefined, origin);
			}
			throw e;
		}

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

		return jsonResponse(
			{
				token,
				refreshToken,
				user: { userId, username, role: 0 } satisfies AuthUser,
			},
			origin,
			undefined,
			201,
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
	const ip = getClientIP(request);
	if (!ip) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Missing client IP" }, origin);
	}
	const rateLimitKey = `chk-usr-ip:${ip}`;
	const currentCount = Number.parseInt((await env.KV.get(rateLimitKey)) ?? "0", 10);
	if (currentCount >= 30) {
		return errorResponse("RATE_LIMITED", 429, undefined, origin);
	}

	// Censor + DB uniqueness check are independent — fire in parallel.
	const [censorResult, existing] = await Promise.all([
		checkCensorWords(username, env),
		env.DB.prepare("SELECT 1 FROM users WHERE username = ?").bind(username).first(),
	]);

	if (censorResult.matched && censorResult.action === "ban") {
		await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });
		return jsonResponse({ available: false, reason: "banned" }, origin);
	}

	if (existing) {
		await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });
		return jsonResponse({ available: false, reason: "taken" }, origin);
	}

	await env.KV.put(rateLimitKey, String(currentCount + 1), { expirationTtl: 60 });
	return jsonResponse({ available: true }, origin);
}
