// Email verification handlers — request-code (7.2) and verify (7.3).
// Refs docs/17-email-verification.md §7.2, §7.3 (rev3).
//
// Endpoints (both authenticated via JWT, but DO NOT require email-verified):
//   POST /api/v1/users/me/email/request-code   body: { email }
//   POST /api/v1/users/me/email/verify         body: { email, code }
//
// rev3 model: pending email lives in KV ONLY. The users table is not touched
// until verify succeeds, at which point we write email + email_normalized +
// email_verified_at in a single conditional UPDATE guarded by
// `email_verified_at = 0`. Uniqueness is enforced by the 0029 partial index
// (`email_normalized != ''`); a constraint violation surfaces as
// 409 EMAIL_ALREADY_IN_USE.
//
// Allowed for unverified users — that's the whole point. Banned users are
// rejected by `withAuthVerified`. Already-verified users are short-circuited
// with `EMAIL_ALREADY_VERIFIED` so accidental re-flows are no-ops.

import type { EmailRequestCodeBody, EmailVerifyCodeBody } from "@ellie/types";
import { sendDoveEmail } from "../lib/dove";
import {
	CODE_TTL_SECONDS,
	type CodeRecord,
	MAX_ATTEMPTS,
	RESEND_THROTTLE_SECONDS,
	SEND_LOCK_TTL_SECONDS,
	codeKvKey,
	computeCodeHmac,
	constantTimeEqualHex,
	generateCode,
	isValidEmail,
	maskEmail,
	normalizeEmail,
	sendLockKvKey,
} from "../lib/email-verify";
import { jsonResponse } from "../lib/response";
import { withAuthVerified } from "../lib/routeHelpers";
import { errorResponse } from "../middleware/error";

interface UserRow {
	email_verified_at: number;
	username: string;
}

function nowSeconds(): number {
	return Math.floor(Date.now() / 1000);
}

async function loadUser(env: { DB: D1Database }, userId: number): Promise<UserRow | null> {
	return env.DB.prepare("SELECT email_verified_at, username FROM users WHERE id = ?")
		.bind(userId)
		.first<UserRow>();
}

/** True if the thrown D1 error matches the partial unique index on email_normalized. */
function isEmailUniqueViolation(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	// D1 surfaces SQLite errors as "UNIQUE constraint failed: users.email_normalized"
	// or similar text mentioning the index name. Match conservatively.
	return /UNIQUE/i.test(msg) && /email_normalized/i.test(msg);
}

/**
 * POST /api/v1/users/me/email/request-code
 *
 * Body: `{ email: "user@example.com" }`
 *
 * Generate a 6-digit code, HMAC it, store the pending envelope (display +
 * normalized form) in KV with 15-min TTL, and dispatch via dove. Only persists
 * state on successful send (so a dove failure leaves the throttle clock
 * untouched and the user can retry).
 *
 * Does NOT touch the users table. The pending email exists only in KV until
 * verifyCode succeeds.
 */
export const requestCode = withAuthVerified(async (request, env, user) => {
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

	// Compile-time hint only — runtime checks below are still authoritative.
	// `Partial<>` preserves "field may be missing / wrong-typed" reality.
	const reqBody = body as Partial<EmailRequestCodeBody>;

	const submittedEmail = typeof reqBody.email === "string" ? reqBody.email.trim() : "";
	if (!isValidEmail(submittedEmail)) {
		return errorResponse("EMAIL_INVALID", 400, undefined, origin);
	}
	const pendingEmailNormalized = normalizeEmail(submittedEmail);

	const dbUser = await loadUser(env, user.userId);
	if (!dbUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	if (dbUser.email_verified_at > 0) {
		return errorResponse("EMAIL_ALREADY_VERIFIED", 403, undefined, origin);
	}

	// Pre-check: reject if another user already owns this normalized email
	// (verified or registered). Gives immediate feedback instead of waiting
	// until verifyCode's UPDATE hits the 0029 unique index. Excludes the
	// requesting user so re-sending to one's own pending email is not blocked.
	const emailOwner = await env.DB.prepare(
		"SELECT id FROM users WHERE email_normalized = ? AND email_normalized != '' AND id != ? LIMIT 1",
	)
		.bind(pendingEmailNormalized, user.userId)
		.first<{ id: number }>();
	if (emailOwner) {
		return errorResponse("EMAIL_ALREADY_IN_USE", 409, undefined, origin);
	}

	const key = codeKvKey(user.userId);
	const lockKey = sendLockKvKey(user.userId);
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

	// In-flight send guard: if another request for this user is mid-Dove, refuse
	// to send a second email. KV is eventually-consistent so this is best-effort
	// — but it closes the window between "throttle check" and "lastSentAt write"
	// where two concurrent callers could each fire a Dove request.
	//
	// We use the same `next_resend_allowed_at` shape so the client treats it
	// identically to a normal throttle (no need for a new error code).
	const lockHeld = await env.KV.get(lockKey);
	if (lockHeld) {
		return errorResponse(
			"CODE_RESEND_THROTTLED",
			429,
			{ next_resend_allowed_at: now + SEND_LOCK_TTL_SECONDS },
			origin,
		);
	}
	await env.KV.put(lockKey, "1", { expirationTtl: SEND_LOCK_TTL_SECONDS });

	const code = generateCode();
	const codeHmac = await computeCodeHmac(
		env.EMAIL_VERIFY_HMAC_KEY,
		user.userId,
		pendingEmailNormalized,
		code,
	);

	// Send first — only persist on success (docs/17 §7.2).
	const sendResult = await sendDoveEmail(env, {
		to: submittedEmail, // exact display form the user typed
		// Slug is configured via env so ops can swap templates without a deploy.
		// Falls back to "verify-email" (the configured Dove slug) if unset.
		template: env.DOVE_TEMPLATE_SLUG || "verify-email",
		// Stable per (user, code) so accidental retries deduplicate at dove.
		idempotencyKey: `${user.userId}:${codeHmac.slice(0, 16)}`,
		// Template only consumes `code` (docs/17 §8). Do NOT add more variables
		// here — extra fields would be silently dropped by dove and create
		// drift between code and the configured template.
		variables: {
			code,
		},
	});

	if (!sendResult.ok) {
		// Release the lock so the user can retry without waiting for TTL.
		await env.KV.delete(lockKey);
		// Log the upstream code server-side for observability — never expose it
		// to the client (would leak Dove allowlist / config state). The log
		// intentionally omits plaintext code, HMAC, and full email.
		console.warn(
			`[email-verify] dove send failed user=${user.userId} ` +
				`recipient=${maskEmail(pendingEmailNormalized)} ` +
				`upstream_code=${sendResult.code} status=${sendResult.status}`,
		);
		return errorResponse("EMAIL_PROVIDER_FAILED", 502, undefined, origin);
	}

	const record: CodeRecord = {
		codeHmac,
		pendingEmail: submittedEmail,
		pendingEmailNormalized,
		expiresAt: now + CODE_TTL_SECONDS,
		attempts: 0,
		lastSentAt: now,
	};

	await env.KV.put(key, JSON.stringify(record), { expirationTtl: CODE_TTL_SECONDS });
	// Release the in-flight lock — the canonical record is now the source of
	// truth and the 60s throttle takes over.
	await env.KV.delete(lockKey);

	return jsonResponse(
		{
			sent_to: maskEmail(pendingEmailNormalized),
			expires_in: CODE_TTL_SECONDS,
			next_resend_allowed_at: now + RESEND_THROTTLE_SECONDS,
		},
		origin,
	);
});

/**
 * POST /api/v1/users/me/email/verify
 *
 * Body: `{ email: "user@example.com", code: "123456" }`
 *
 * The body email MUST match the pending email saved by the most recent
 * request-code; otherwise we return 409 EMAIL_CODE_EMAIL_MISMATCH without
 * burning an attempt — the mismatch usually means the user re-typed a
 * different address, not a brute force.
 *
 * On success: writes `email`, `email_normalized`, and `email_verified_at` in
 * a single conditional UPDATE guarded by `email_verified_at = 0` (one-shot
 * first-add semantics in rev3) and deletes the KV record. JWT keeps working
 * — no logout needed.
 *
 * `email_changed_at` is intentionally NOT written here — rev3 treats this as
 * the first-add path; subsequent change flows are out of scope.
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

	// Compile-time hint only — runtime checks below remain authoritative.
	const verifyBody = body as Partial<EmailVerifyCodeBody>;

	const submittedEmail = typeof verifyBody.email === "string" ? verifyBody.email.trim() : "";
	if (!isValidEmail(submittedEmail)) {
		return errorResponse("EMAIL_INVALID", 400, undefined, origin);
	}
	const submittedEmailNormalized = normalizeEmail(submittedEmail);

	const submittedCode = typeof verifyBody.code === "string" ? verifyBody.code.trim() : "";
	if (!/^\d{6}$/.test(submittedCode)) {
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

	// Body email must match the pending email this code was issued for. We
	// compare normalized forms so casing / whitespace differences don't trip
	// honest users. Mismatch ≠ brute force, so we do NOT burn an attempt.
	if (record.pendingEmailNormalized !== submittedEmailNormalized) {
		return errorResponse("EMAIL_CODE_EMAIL_MISMATCH", 409, undefined, origin);
	}

	const submittedHmac = await computeCodeHmac(
		env.EMAIL_VERIFY_HMAC_KEY,
		user.userId,
		record.pendingEmailNormalized,
		submittedCode,
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

	// Success path: write email + normalized + verified-at in a single
	// conditional UPDATE. The `email_verified_at = 0` guard is a one-shot
	// first-add gate (NOT a concurrency primitive — D1 serializes per row).
	// `email_changed_at` is intentionally untouched in rev3.
	try {
		const result = await env.DB.prepare(
			"UPDATE users SET email = ?, email_normalized = ?, email_verified_at = ? WHERE id = ? AND email_verified_at = 0",
		)
			.bind(record.pendingEmail, record.pendingEmailNormalized, now, user.userId)
			.run();

		// If the guard missed (someone verified out-of-band between loadUser and
		// here), surface the same already-verified contract.
		const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
		if (changes === 0) {
			return errorResponse("EMAIL_ALREADY_VERIFIED", 403, undefined, origin);
		}
	} catch (err) {
		if (isEmailUniqueViolation(err)) {
			// 0029 partial unique index rejected the write — another account
			// already owns this normalized email. Leave the KV record so the
			// user can retry with a different address via request-code.
			return errorResponse("EMAIL_ALREADY_IN_USE", 409, undefined, origin);
		}
		throw err;
	}
	await env.KV.delete(key);

	return jsonResponse({ verified: true, verified_at: now }, origin);
});

/**
 * POST /api/v1/users/me/email/correct
 *
 * Body: `{ email: "new@example.com" }`
 *
 * One-shot pre-verification email correction. The user is allowed to fix a
 * typo in the registered email address ONCE before they verify it. This is
 * useful when registration captured a wrong address and the verification
 * code therefore can never arrive.
 *
 * Guards (single conditional UPDATE):
 *   - `email_verified_at = 0`   — verified users go through admin support
 *     instead; surfaced as `EMAIL_NOT_CORRECTABLE`.
 *   - `email_changed_at = 0`    — only one correction is allowed; surfaced as
 *     `EMAIL_CORRECTION_USED`.
 *
 * On success the new address is written to both `email` and
 * `email_normalized`, and `email_changed_at` is stamped to "now". Writing the
 * normalized form (rather than clearing it) keeps the new address protected
 * by the partial UNIQUE index on `email_normalized`, while the old address is
 * naturally released.
 *
 * Any pending verification code in KV is invalidated — it was issued for the
 * old address and would silently fail the email-mismatch guard otherwise.
 *
 * NB: this endpoint exists explicitly because `PATCH /api/v1/users/me`
 * rejects an `email` field with `EMAIL_NOT_EDITABLE_HERE`. The verified-
 * email change flow (post-verification) is intentionally out of scope.
 */
export const correctPendingEmail = withAuthVerified(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const submittedEmail = typeof body.email === "string" ? body.email.trim() : "";
	if (!isValidEmail(submittedEmail)) {
		return errorResponse("EMAIL_INVALID", 400, undefined, origin);
	}
	const newEmailNormalized = normalizeEmail(submittedEmail);

	// Load the row so we can return precise error codes (verified vs.
	// already-corrected vs. unchanged) instead of a generic 0-rows-affected.
	// We also need `email_normalized` to reject same-as-current submissions —
	// otherwise the user could waste their one-shot correction on a no-op.
	const row = await env.DB.prepare(
		"SELECT email_verified_at, email_changed_at, email_normalized FROM users WHERE id = ?",
	)
		.bind(user.userId)
		.first<{
			email_verified_at: number;
			email_changed_at: number;
			email_normalized: string;
		}>();
	if (!row) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}
	if (row.email_verified_at > 0) {
		return errorResponse("EMAIL_NOT_CORRECTABLE", 403, undefined, origin);
	}
	if (row.email_changed_at > 0) {
		return errorResponse("EMAIL_CORRECTION_USED", 403, undefined, origin);
	}
	// Same-as-current guard. Compare normalized forms so casing / whitespace
	// noise doesn't sneak through and burn the one-shot correction.
	if (row.email_normalized === newEmailNormalized) {
		return errorResponse("EMAIL_UNCHANGED", 400, undefined, origin);
	}

	// Pre-check uniqueness against other users so we can return a clean 409
	// before hitting the partial unique index.
	const owner = await env.DB.prepare(
		"SELECT id FROM users WHERE email_normalized = ? AND email_normalized != '' AND id != ? LIMIT 1",
	)
		.bind(newEmailNormalized, user.userId)
		.first<{ id: number }>();
	if (owner) {
		return errorResponse("EMAIL_ALREADY_IN_USE", 409, undefined, origin);
	}

	const now = nowSeconds();
	try {
		const result = await env.DB.prepare(
			"UPDATE users SET email = ?, email_normalized = ?, email_changed_at = ? WHERE id = ? AND email_verified_at = 0 AND email_changed_at = 0",
		)
			.bind(submittedEmail, newEmailNormalized, now, user.userId)
			.run();

		const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
		if (changes === 0) {
			// Lost the race — re-derive a precise code from a fresh row read.
			const fresh = await env.DB.prepare(
				"SELECT email_verified_at, email_changed_at FROM users WHERE id = ?",
			)
				.bind(user.userId)
				.first<{ email_verified_at: number; email_changed_at: number }>();
			if (!fresh) return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
			if (fresh.email_verified_at > 0) {
				return errorResponse("EMAIL_NOT_CORRECTABLE", 403, undefined, origin);
			}
			return errorResponse("EMAIL_CORRECTION_USED", 403, undefined, origin);
		}
	} catch (err) {
		if (isEmailUniqueViolation(err)) {
			return errorResponse("EMAIL_ALREADY_IN_USE", 409, undefined, origin);
		}
		throw err;
	}

	// Drop any pending code envelope — it was HMAC-bound to the old normalized
	// email and would only confuse the user (mismatch on next verify).
	await env.KV.delete(codeKvKey(user.userId));

	return jsonResponse(
		{
			email: maskEmail(newEmailNormalized),
			email_changed_at: now,
		},
		origin,
	);
});
