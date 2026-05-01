// Email verification handlers — request-code (7.2) and verify (7.3).
// Refs docs/17-email-verification.md §7.2, §7.3.
//
// Endpoints (both authenticated via JWT, but DO NOT require email-verified):
//   POST /api/v1/users/me/email/request-code
//   POST /api/v1/users/me/email/verify
//
// Allowed for unverified users — that's the whole point. Banned users are
// rejected by `withAuthVerified`. Already-verified users are short-circuited
// with `EMAIL_ALREADY_VERIFIED` so accidental re-flows are no-ops.

import { sendDoveEmail } from "../lib/dove";
import {
	CODE_TTL_SECONDS,
	type CodeRecord,
	MAX_ATTEMPTS,
	RESEND_THROTTLE_SECONDS,
	codeKvKey,
	computeCodeHmac,
	constantTimeEqualHex,
	generateCode,
	isValidEmail,
	maskEmail,
	normalizeEmail,
} from "../lib/email-verify";
import { jsonResponse } from "../lib/response";
import { withAuthVerified } from "../lib/routeHelpers";
import { errorResponse } from "../middleware/error";

interface UserRow {
	email: string;
	email_normalized: string;
	email_verified_at: number;
	username: string;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

async function loadUser(env: { DB: D1Database }, userId: number): Promise<UserRow | null> {
	return env.DB.prepare(
		"SELECT email, email_normalized, email_verified_at, username FROM users WHERE id = ?",
	)
		.bind(userId)
		.first<UserRow>();
}

/**
 * POST /api/v1/users/me/email/request-code
 *
 * Generate a 6-digit code, HMAC it, store the envelope in KV with 15-min TTL,
 * and dispatch via dove. Only persists state on successful send (so a dove
 * failure leaves the throttle clock untouched and the user can retry).
 */
export const requestCode = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	if (!env.EMAIL_VERIFY_HMAC_KEY) {
		// Server is misconfigured — never expose plaintext clue, but fail loud.
		return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
	}

	const dbUser = await loadUser(env, user.userId);
	if (!dbUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	if (dbUser.email_verified_at > 0) {
		return errorResponse("EMAIL_ALREADY_VERIFIED", 403, undefined, origin);
	}

	const targetEmailNormalized = dbUser.email_normalized || normalizeEmail(dbUser.email);
	if (!isValidEmail(targetEmailNormalized)) {
		// Legacy / corrupt row — user must hit POST /api/v1/users/me/email first
		// (phase 5). Until then we cannot deliver anywhere.
		return errorResponse("EMAIL_INVALID", 400, undefined, origin);
	}

	const key = codeKvKey(user.userId);
	const now = nowSeconds();

	// Resend throttle — read existing record, if any.
	const existingRaw = await env.KV.get(key);
	if (existingRaw) {
		try {
			const existing = JSON.parse(existingRaw) as CodeRecord;
			if (existing.lastSentAt && now - existing.lastSentAt < RESEND_THROTTLE_SECONDS) {
				const nextAllowed = existing.lastSentAt + RESEND_THROTTLE_SECONDS;
				return errorResponse(
					"CODE_RESEND_THROTTLED",
					429,
					{ next_resend_allowed_at: nextAllowed },
					origin,
				);
			}
		} catch {
			// Corrupt record → fall through and overwrite below.
		}
	}

	const code = generateCode();
	const codeHmac = await computeCodeHmac(
		env.EMAIL_VERIFY_HMAC_KEY,
		user.userId,
		targetEmailNormalized,
		code,
	);

	// Send first — only persist on success (docs/17 §7.2).
	const sendResult = await sendDoveEmail(env, {
		to: dbUser.email, // exact display form
		template: "ellie-email-verify",
		// Stable per (user, code) so accidental retries deduplicate at dove.
		idempotencyKey: `${user.userId}:${codeHmac.slice(0, 16)}`,
		variables: {
			code,
			expires_in_minutes: String(Math.floor(CODE_TTL_SECONDS / 60)),
			username: dbUser.username,
		},
	});

	if (!sendResult.ok) {
		// IMPORTANT: do NOT mutate KV. The caller can retry without burning
		// the throttle, and an attacker who flips dove offline cannot lock
		// users out of new codes.
		return errorResponse("EMAIL_PROVIDER_FAILED", 502, { provider_code: sendResult.code }, origin);
	}

	const record: CodeRecord = {
		codeHmac,
		targetEmailNormalized,
		expiresAt: now + CODE_TTL_SECONDS,
		attempts: 0,
		lastSentAt: now,
	};

	await env.KV.put(key, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });

	return jsonResponse(
		{
			sent_to: maskEmail(targetEmailNormalized),
			expires_in: CODE_TTL_SECONDS,
			next_resend_allowed_at: now + RESEND_THROTTLE_SECONDS,
		},
		origin,
	);
});

/**
 * POST /api/v1/users/me/email/verify
 *
 * Accepts `{ code: "123456" }`. On success: sets `email_verified_at = now()`
 * and deletes the KV record. JWT keeps working — no logout needed.
 */
export const verifyCode = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	if (!env.EMAIL_VERIFY_HMAC_KEY) {
		return errorResponse("INTERNAL_ERROR", 500, undefined, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const submitted = typeof body.code === "string" ? body.code.trim() : "";
	if (!/^\d{6}$/.test(submitted)) {
		return errorResponse("CODE_FORMAT_INVALID", 400, undefined, origin);
	}

	const dbUser = await loadUser(env, user.userId);
	if (!dbUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	if (dbUser.email_verified_at > 0) {
		return errorResponse("EMAIL_ALREADY_VERIFIED", 403, undefined, origin);
	}

	const key = codeKvKey(user.userId);
	const raw = await env.KV.get(key);
	if (!raw) {
		return errorResponse("CODE_NOT_FOUND", 404, undefined, origin);
	}

	let record: CodeRecord;
	try {
		record = JSON.parse(raw) as CodeRecord;
	} catch {
		// Corrupt — treat as "no code". Delete defensively so a clean retry works.
		await env.KV.delete(key);
		return errorResponse("CODE_NOT_FOUND", 404, undefined, origin);
	}

	const now = nowSeconds();

	// Defensive expiry check (KV TTL should already evict, but clocks/edge
	// caches can briefly disagree — make the contract explicit).
	if (record.expiresAt && record.expiresAt <= now) {
		await env.KV.delete(key);
		return errorResponse("CODE_NOT_FOUND", 404, undefined, origin);
	}

	const currentNormalized = dbUser.email_normalized || normalizeEmail(dbUser.email);
	if (record.targetEmailNormalized !== currentNormalized) {
		// Email changed since the code was issued — invalidate so the next
		// request-code starts from a clean slate.
		await env.KV.delete(key);
		return errorResponse("EMAIL_CHANGED_SINCE_CODE", 409, undefined, origin);
	}

	const submittedHmac = await computeCodeHmac(
		env.EMAIL_VERIFY_HMAC_KEY,
		user.userId,
		record.targetEmailNormalized,
		submitted,
	);

	if (!constantTimeEqualHex(submittedHmac, record.codeHmac)) {
		const nextAttempts = record.attempts + 1;
		if (nextAttempts >= MAX_ATTEMPTS) {
			await env.KV.delete(key);
			return errorResponse("CODE_LOCKED", 403, undefined, origin);
		}
		const updated: CodeRecord = { ...record, attempts: nextAttempts };
		// Preserve remaining TTL — re-derive from `expiresAt`. Floor to 1 to
		// avoid `expirationTtl: 0` (KV rejects).
		const remaining = Math.max(1, record.expiresAt - now);
		await env.KV.put(key, JSON.stringify(updated), { expirationTtl: remaining });
		return errorResponse(
			"CODE_INVALID",
			403,
			{ attempts_remaining: MAX_ATTEMPTS - nextAttempts },
			origin,
		);
	}

	// Success path: persist verification, then delete KV.
	await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?")
		.bind(now, user.userId)
		.run();
	await env.KV.delete(key);

	return jsonResponse({ verified: true, verified_at: now }, origin);
});
