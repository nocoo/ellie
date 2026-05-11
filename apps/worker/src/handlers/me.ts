// User self-service handlers for Cloudflare Worker
import { toUser } from "../lib/mappers";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../lib/password";
import { jsonResponse } from "../lib/response";
import { withAuthVerified, withVerifiedEmail } from "../lib/routeHelpers";
import { invalidateUserCache } from "../lib/user-cache";
import { errorResponse } from "../middleware/error";

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, avatar_path, status, role, reg_date, last_login, threads, posts, credits, coins, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, campus, last_activity, email_verified_at, email_normalized, email_changed_at";

/** Max lengths for text fields */
export const MAX_LENGTHS: Record<string, number> = {
	email: 255,
	avatar: 500,
	campus: 100,
	resideProvince: 50,
	resideCity: 50,
	graduateSchool: 100,
	bio: 500,
	interest: 500,
	qq: 20,
	site: 200,
	signature: 1000,
};

/** Field name to error message mapping */
const LENGTH_ERRORS: Record<string, string> = {
	campus: "Campus too long",
	resideProvince: "Province name too long",
	resideCity: "City name too long",
	graduateSchool: "School name too long",
	bio: "Bio too long",
	interest: "Interest too long",
	qq: "QQ too long",
	site: "Site URL too long",
	signature: "Signature too long",
};

/** Field name to DB column mapping */
export const DB_COLUMNS: Record<string, string> = {
	email: "email",
	avatar: "avatar",
	gender: "gender",
	birthYear: "birth_year",
	birthMonth: "birth_month",
	birthDay: "birth_day",
	campus: "campus",
	resideProvince: "reside_province",
	resideCity: "reside_city",
	graduateSchool: "graduate_school",
	bio: "bio",
	interest: "interest",
	qq: "qq",
	site: "site",
	signature: "signature",
};

/** Extract string field from body */
export function extractString(body: Record<string, unknown>, key: string): string | undefined {
	const val = body[key];
	return typeof val === "string" ? val.trim() : undefined;
}

/** Extract number field from body */
export function extractNumber(body: Record<string, unknown>, key: string): number | undefined {
	const val = body[key];
	return typeof val === "number" ? val : undefined;
}

/** Validate string length */
function validateLength(
	value: string | undefined,
	key: string,
	origin: string | undefined,
): Response | null {
	const max = MAX_LENGTHS[key];
	if (value !== undefined && max !== undefined && value.length > max) {
		return errorResponse("INVALID_BODY", 400, { message: LENGTH_ERRORS[key] }, origin);
	}
	return null;
}

/** Validation result - either success with fields or error response */
type ValidationResult =
	| { success: true; fields: Record<string, unknown> }
	| { success: false; error: Response };

/** Validate birthday, QQ, and site fields. Returns error Response or null if valid. */
function validateExtendedFields(
	birthYear: number | undefined,
	birthMonth: number | undefined,
	birthDay: number | undefined,
	qq: string | undefined,
	site: string | undefined,
	origin: string | undefined,
): Response | null {
	// Birthday: if any field provided, require all three
	const hasBirthYear = birthYear !== undefined;
	const hasBirthMonth = birthMonth !== undefined;
	const hasBirthDay = birthDay !== undefined;
	if (
		(hasBirthYear || hasBirthMonth || hasBirthDay) &&
		!(hasBirthYear && hasBirthMonth && hasBirthDay)
	) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "Incomplete birthday — provide year, month, and day" },
			origin,
		);
	}
	const currentYear = new Date().getFullYear();
	if (birthYear !== undefined && (birthYear < 1900 || birthYear > currentYear)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid birth year" }, origin);
	}
	if (birthMonth !== undefined && (birthMonth < 1 || birthMonth > 12)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid birth month" }, origin);
	}
	if (birthDay !== undefined && birthYear !== undefined && birthMonth !== undefined) {
		const maxDay = new Date(birthYear, birthMonth, 0).getDate();
		if (birthDay < 1 || birthDay > maxDay) {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid birth day" }, origin);
		}
	}

	// QQ: numeric only
	if (qq !== undefined && qq.length > 0 && !/^\d+$/.test(qq)) {
		return errorResponse("INVALID_BODY", 400, { message: "QQ must be numeric" }, origin);
	}

	// Site: http/https URL
	if (site !== undefined && site.length > 0) {
		try {
			const url = new URL(site);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return errorResponse(
					"INVALID_BODY",
					400,
					{ message: "Site must use http or https" },
					origin,
				);
			}
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid site URL" }, origin);
		}
	}

	return null;
}

/** Validate all profile fields and return collected fields or error.
 * @param skipEmptyCheck - If true, don't require at least one field (used by register) */
export function validateProfileFields(
	body: Record<string, unknown>,
	origin: string | undefined,
	skipEmptyCheck = false,
): ValidationResult {
	// Extract fields
	const email = extractString(body, "email");
	const avatar = extractString(body, "avatar");
	const gender = extractNumber(body, "gender");
	const birthYear = extractNumber(body, "birthYear");
	const birthMonth = extractNumber(body, "birthMonth");
	const birthDay = extractNumber(body, "birthDay");
	const campus = extractString(body, "campus");
	const resideProvince = extractString(body, "resideProvince");
	const resideCity = extractString(body, "resideCity");
	const graduateSchool = extractString(body, "graduateSchool");
	const bio = extractString(body, "bio");
	const interest = extractString(body, "interest");
	const qq = extractString(body, "qq");
	const site = extractString(body, "site");
	const signature = extractString(body, "signature");

	const fields: Record<string, unknown> = {
		email,
		avatar,
		gender,
		birthYear,
		birthMonth,
		birthDay,
		campus,
		resideProvince,
		resideCity,
		graduateSchool,
		bio,
		interest,
		qq,
		site,
		signature,
	};

	// Check at least one field provided (skipped for registration — all profile fields optional)
	if (!skipEmptyCheck && !Object.values(fields).some((v) => v !== undefined)) {
		return {
			success: false,
			error: errorResponse("INVALID_BODY", 400, { message: "At least one field required" }, origin),
		};
	}

	// Validate email format
	if (email !== undefined) {
		if (email.length === 0 || !email.includes("@") || email.length > MAX_LENGTHS.email) {
			return {
				success: false,
				error: errorResponse("INVALID_BODY", 400, { message: "Invalid email format" }, origin),
			};
		}
	}

	// Validate gender (0 = not set, 1 = male, 2 = female)
	if (gender !== undefined && (gender < 0 || gender > 2)) {
		return {
			success: false,
			error: errorResponse("INVALID_BODY", 400, { message: "Invalid gender value" }, origin),
		};
	}

	// Validate birthday, QQ, site via extracted helper
	const extendedError = validateExtendedFields(birthYear, birthMonth, birthDay, qq, site, origin);
	if (extendedError) return { success: false, error: extendedError };

	// Validate string lengths
	for (const key of Object.keys(LENGTH_ERRORS)) {
		const err = validateLength(fields[key] as string | undefined, key, origin);
		if (err) return { success: false, error: err };
	}

	return { success: true, fields };
}

/** PATCH /api/v1/users/me — Update own profile */
export const updateProfile = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	// Validate all fields
	const validation = validateProfileFields(body, origin);
	if (!validation.success) {
		return validation.error;
	}
	const { fields } = validation;

	// Build dynamic SET clause
	const setClauses: string[] = [];
	const params: unknown[] = [];

	for (const [key, value] of Object.entries(fields)) {
		if (value !== undefined && DB_COLUMNS[key]) {
			setClauses.push(`${DB_COLUMNS[key]} = ?`);
			params.push(value);
		}
	}

	params.push(user.userId);

	await env.DB.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`)
		.bind(...params)
		.run();

	// Invalidate user cache (KV) and fetch updated row (D1) in parallel — the
	// cache invalidation doesn't gate the fetch result.
	const [, row] = await Promise.all([
		fields.avatar !== undefined ? invalidateUserCache(env, user.userId) : Promise.resolve(),
		env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(user.userId).first(),
	]);

	if (!row) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toUser(row as Record<string, unknown>), origin);
});

/** POST /api/v1/users/me/password — Change own password */
export const changePassword = withAuthVerified(async (request, env, user) => {
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

	// Verify old password and pre-compute the new hash in parallel.
	// hashPassword is the slow step (PBKDF2) and the new hash is needed on
	// every success path; pre-computing it lets the verify and hash work
	// overlap. On failure we discard the hash — acceptable cost since the
	// failure case is also rate-limited at the IP layer.
	const newHashPromise = hashPassword(newPassword);
	let isValid = false;
	if (row.password_salt) {
		isValid = await verifyDiscuzPassword(oldPassword, row.password_hash, row.password_salt);
	} else {
		isValid = await verifyPassword(oldPassword, row.password_hash);
	}

	if (!isValid) {
		// Drain the in-flight hash so we don't leak an unhandled rejection.
		newHashPromise.catch(() => {});
		return errorResponse("WRONG_PASSWORD", 401, undefined, origin);
	}

	const newHash = await newHashPromise;
	await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = '' WHERE id = ?")
		.bind(newHash, user.userId)
		.run();

	return jsonResponse({ updated: true }, origin);
});
