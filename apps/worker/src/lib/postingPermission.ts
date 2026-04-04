// Posting permission check — shared between thread/post creation and private messaging
// Ref: docs/12-private-messages.md §3.2

import { errorResponse } from "../middleware/error";
import type { Env } from "./env";

/** User info needed for posting permission check */
export interface PostingUser {
	userId: number;
	status: number;
	role: number;
}

/** Posting permission check result */
export type PostingPermissionResult =
	| { allowed: true }
	| { allowed: false; error: Response };

/**
 * Get posting restriction settings from DB (features.posting.* keys).
 * Returns defaults if settings are not found.
 */
async function getPostingSettings(env: Env): Promise<{
	enabled: boolean;
	minRegistrationDays: number;
	requireAvatar: boolean;
}> {
	const result = await env.DB.prepare(
		"SELECT key, value FROM settings WHERE key LIKE 'features.posting.%'",
	).all<{ key: string; value: string }>();

	const settings: Record<string, string> = {};
	for (const row of result.results) {
		settings[row.key] = row.value;
	}

	return {
		enabled: settings["features.posting.enabled"] === "true",
		minRegistrationDays: Number.parseInt(
			settings["features.posting.min_registration_days"] ?? "0",
			10,
		),
		requireAvatar: settings["features.posting.require_avatar"] === "true",
	};
}

/**
 * Check if a user has permission to post (create thread/reply) or send private messages.
 *
 * Checks:
 * 1. User status >= 0 (not banned/muted)
 * 2. If posting restrictions enabled:
 *    - Registration days >= min_registration_days
 *    - Avatar required → user must have avatar set
 *
 * @param env - Cloudflare Worker environment
 * @param user - User info from auth token
 * @param origin - Request origin for CORS headers
 * @returns Promise<PostingPermissionResult>
 */
export async function checkPostingPermission(
	env: Env,
	user: PostingUser,
	origin?: string,
): Promise<PostingPermissionResult> {
	// Fetch user details from DB to check status, avatar, reg_date
	const userRow = await env.DB.prepare(
		"SELECT status, avatar, reg_date, role FROM users WHERE id = ?",
	)
		.bind(user.userId)
		.first<{ status: number; avatar: string; reg_date: number; role: number }>();

	if (!userRow) {
		return {
			allowed: false,
			error: errorResponse("USER_NOT_FOUND", 404, undefined, origin),
		};
	}

	// Check 1: User status (banned = -1, muted = -2)
	if (userRow.status < 0) {
		const message =
			userRow.status === -1
				? "您的账号已被封禁，无法发送内容"
				: "您的账号已被禁言，无法发送内容";
		return {
			allowed: false,
			error: errorResponse("FORBIDDEN", 403, { message }, origin),
		};
	}

	// Check 2: Posting restrictions (skip for staff: role >= 1)
	if (userRow.role < 1) {
		const settings = await getPostingSettings(env);

		if (settings.enabled) {
			// Check registration days
			if (settings.minRegistrationDays > 0) {
				const nowSeconds = Math.floor(Date.now() / 1000);
				const registrationDays = Math.floor((nowSeconds - userRow.reg_date) / 86400);

				if (registrationDays < settings.minRegistrationDays) {
					return {
						allowed: false,
						error: errorResponse(
							"POSTING_RESTRICTION",
							403,
							{
								message: `您的账号注册不满 ${settings.minRegistrationDays} 天，暂时无法发送内容`,
								code: "MIN_REGISTRATION_DAYS",
								required: settings.minRegistrationDays,
								current: registrationDays,
							},
							origin,
						),
					};
				}
			}

			// Check avatar requirement
			if (settings.requireAvatar && !userRow.avatar) {
				return {
					allowed: false,
					error: errorResponse(
						"POSTING_RESTRICTION",
						403,
						{
							message: "您需要设置头像后才能发送内容",
							code: "REQUIRE_AVATAR",
						},
						origin,
					),
				};
			}
		}
	}

	return { allowed: true };
}
