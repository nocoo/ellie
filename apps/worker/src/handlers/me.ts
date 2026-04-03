// User self-service handlers for Cloudflare Worker
import { toUser } from "../lib/mappers";
import { hashPassword, verifyDiscuzPassword, verifyPassword } from "../lib/password";
import { jsonResponse } from "../lib/response";
import { withAuth } from "../lib/routeHelpers";
import { invalidateUserCache } from "../lib/user-cache";
import { errorResponse } from "../middleware/error";

/** Explicit column list — never SELECT * to avoid leaking sensitive fields */
const USER_COLUMNS =
	"id, username, email, avatar, status, role, reg_date, last_login, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, last_activity";

/** Max lengths for text fields */
const MAX_LENGTHS = {
	email: 255,
	avatar: 500,
	resideProvince: 50,
	resideCity: 50,
	graduateSchool: 100,
	bio: 500,
	interest: 500,
	qq: 20,
	site: 200,
	signature: 1000,
};

/** PATCH /api/v1/users/me — Update own profile */
export const updateProfile = withAuth(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	// Extract and validate fields
	const email = typeof body.email === "string" ? body.email.trim() : undefined;
	const avatar = typeof body.avatar === "string" ? body.avatar.trim() : undefined;
	const gender = typeof body.gender === "number" ? body.gender : undefined;
	const birthYear = typeof body.birthYear === "number" ? body.birthYear : undefined;
	const birthMonth = typeof body.birthMonth === "number" ? body.birthMonth : undefined;
	const birthDay = typeof body.birthDay === "number" ? body.birthDay : undefined;
	const resideProvince =
		typeof body.resideProvince === "string" ? body.resideProvince.trim() : undefined;
	const resideCity = typeof body.resideCity === "string" ? body.resideCity.trim() : undefined;
	const graduateSchool =
		typeof body.graduateSchool === "string" ? body.graduateSchool.trim() : undefined;
	const bio = typeof body.bio === "string" ? body.bio.trim() : undefined;
	const interest = typeof body.interest === "string" ? body.interest.trim() : undefined;
	const qq = typeof body.qq === "string" ? body.qq.trim() : undefined;
	const site = typeof body.site === "string" ? body.site.trim() : undefined;
	const signature = typeof body.signature === "string" ? body.signature.trim() : undefined;

	// Check at least one field provided
	const hasAnyField =
		email !== undefined ||
		avatar !== undefined ||
		gender !== undefined ||
		birthYear !== undefined ||
		birthMonth !== undefined ||
		birthDay !== undefined ||
		resideProvince !== undefined ||
		resideCity !== undefined ||
		graduateSchool !== undefined ||
		bio !== undefined ||
		interest !== undefined ||
		qq !== undefined ||
		site !== undefined ||
		signature !== undefined;

	if (!hasAnyField) {
		return errorResponse("INVALID_BODY", 400, { message: "At least one field required" }, origin);
	}

	// Validate email format if provided
	if (email !== undefined) {
		if (email.length === 0 || !email.includes("@") || email.length > MAX_LENGTHS.email) {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid email format" }, origin);
		}
	}

	// Validate gender (0 = not set, 1 = male, 2 = female)
	if (gender !== undefined && (gender < 0 || gender > 2)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid gender value" }, origin);
	}

	// Validate birthday fields
	if (birthYear !== undefined && (birthYear < 0 || birthYear > 2100)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid birth year" }, origin);
	}
	if (birthMonth !== undefined && (birthMonth < 0 || birthMonth > 12)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid birth month" }, origin);
	}
	if (birthDay !== undefined && (birthDay < 0 || birthDay > 31)) {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid birth day" }, origin);
	}

	// Validate string lengths
	if (resideProvince !== undefined && resideProvince.length > MAX_LENGTHS.resideProvince) {
		return errorResponse("INVALID_BODY", 400, { message: "Province name too long" }, origin);
	}
	if (resideCity !== undefined && resideCity.length > MAX_LENGTHS.resideCity) {
		return errorResponse("INVALID_BODY", 400, { message: "City name too long" }, origin);
	}
	if (graduateSchool !== undefined && graduateSchool.length > MAX_LENGTHS.graduateSchool) {
		return errorResponse("INVALID_BODY", 400, { message: "School name too long" }, origin);
	}
	if (bio !== undefined && bio.length > MAX_LENGTHS.bio) {
		return errorResponse("INVALID_BODY", 400, { message: "Bio too long" }, origin);
	}
	if (interest !== undefined && interest.length > MAX_LENGTHS.interest) {
		return errorResponse("INVALID_BODY", 400, { message: "Interest too long" }, origin);
	}
	if (qq !== undefined && qq.length > MAX_LENGTHS.qq) {
		return errorResponse("INVALID_BODY", 400, { message: "QQ too long" }, origin);
	}
	if (site !== undefined && site.length > MAX_LENGTHS.site) {
		return errorResponse("INVALID_BODY", 400, { message: "Site URL too long" }, origin);
	}
	if (signature !== undefined && signature.length > MAX_LENGTHS.signature) {
		return errorResponse("INVALID_BODY", 400, { message: "Signature too long" }, origin);
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
	if (gender !== undefined) {
		setClauses.push("gender = ?");
		params.push(gender);
	}
	if (birthYear !== undefined) {
		setClauses.push("birth_year = ?");
		params.push(birthYear);
	}
	if (birthMonth !== undefined) {
		setClauses.push("birth_month = ?");
		params.push(birthMonth);
	}
	if (birthDay !== undefined) {
		setClauses.push("birth_day = ?");
		params.push(birthDay);
	}
	if (resideProvince !== undefined) {
		setClauses.push("reside_province = ?");
		params.push(resideProvince);
	}
	if (resideCity !== undefined) {
		setClauses.push("reside_city = ?");
		params.push(resideCity);
	}
	if (graduateSchool !== undefined) {
		setClauses.push("graduate_school = ?");
		params.push(graduateSchool);
	}
	if (bio !== undefined) {
		setClauses.push("bio = ?");
		params.push(bio);
	}
	if (interest !== undefined) {
		setClauses.push("interest = ?");
		params.push(interest);
	}
	if (qq !== undefined) {
		setClauses.push("qq = ?");
		params.push(qq);
	}
	if (site !== undefined) {
		setClauses.push("site = ?");
		params.push(site);
	}
	if (signature !== undefined) {
		setClauses.push("signature = ?");
		params.push(signature);
	}

	params.push(user.userId);

	await env.DB.prepare(`UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`)
		.bind(...params)
		.run();

	// Invalidate user cache if avatar was changed (it's a cached field)
	if (avatar !== undefined) {
		await invalidateUserCache(env, user.userId);
	}

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
