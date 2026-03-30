// User self-service handlers for Cloudflare Worker
import { toUser } from "../lib/mappers";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../lib/password";
import { jsonResponse } from "../lib/response";
import { withAuth } from "../lib/routeHelpers";
import { errorResponse } from "../middleware/error";

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits, signature";

/** PATCH /api/v1/users/me — Update own profile (avatar, email) */
export const updateProfile = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const email = typeof body.email === "string" ? body.email.trim() : undefined;
	const avatar = typeof body.avatar === "string" ? body.avatar.trim() : undefined;

	if (email === undefined && avatar === undefined) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "At least one field required (email, avatar)" },
			origin,
		);
	}

	// Validate email format if provided
	if (email !== undefined) {
		if (email.length === 0 || !email.includes("@") || email.length > 255) {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid email format" }, origin);
		}
	}

	// Build dynamic SET clause
	const setClauses: string[] = [];
	const params: unknown[] = [];
	if (email !== undefined) {
		setClauses.push("email = ?");
		params.push(email);
	}
	if (avatar !== undefined) {
		setClauses.push("avatar = ?");
		params.push(avatar);
	}
	params.push(user.userId);

	await env.DB.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`)
		.bind(...params)
		.run();

	// Fetch updated user
	const row = await env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(user.userId)
		.first();

	if (!row) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toUser(row as Record<string, unknown>), origin);
});

/** POST /api/v1/users/me/password — Change own password */
export const changePassword = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const oldPassword = typeof body.oldPassword === "string" ? body.oldPassword : undefined;
	const newPassword = typeof body.newPassword === "string" ? body.newPassword : undefined;

	if (!oldPassword || !newPassword) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "oldPassword and newPassword are required" },
			origin,
		);
	}

	if (newPassword.length < 6) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "newPassword must be at least 6 characters" },
			origin,
		);
	}

	// Fetch current password hash
	const row = await env.DB.prepare("SELECT password_hash, password_salt FROM users WHERE id = ?")
		.bind(user.userId)
		.first<{ password_hash: string; password_salt: string }>();

	if (!row) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Verify old password (support both Discuz and PBKDF2 formats)
	let isValid = false;
	if (row.password_salt) {
		isValid = await verifyDiscuzPassword(oldPassword, row.password_hash, row.password_salt);
	} else {
		isValid = await verifyPassword(oldPassword, row.password_hash);
	}

	if (!isValid) {
		return errorResponse("WRONG_PASSWORD", 401, undefined, origin);
	}

	// Hash new password with PBKDF2, clear salt
	const newHash = await hashPassword(newPassword);
	await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = '' WHERE id = ?")
		.bind(newHash, user.userId)
		.run();

	return jsonResponse({ updated: true }, origin);
});
