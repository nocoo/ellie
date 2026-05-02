// Email verification primitives — code generation, HMAC, KV envelope.
// Refs docs/17-email-verification.md §6.2, §7.2, §7.3.
//
// All values are isolated per-user under the KV key `email_verify:<userId>`.
// Plaintext codes never touch storage; only the HMAC fingerprint is persisted.

/** TTL for a fresh KV record, in seconds (docs/17 §6.2). */
export const CODE_TTL_SECONDS = 900; // 15 minutes
/** Resend throttle window, in seconds (docs/17 §7.2). */
export const RESEND_THROTTLE_SECONDS = 60;
/** Max wrong-code attempts before the KV record is invalidated (docs/17 §7.3). */
export const MAX_ATTEMPTS = 5;
/** In-flight send-lock TTL, in seconds. Long enough to outlast a slow Dove call,
 *  short enough that a crashed worker doesn't lock the user out for long. */
export const SEND_LOCK_TTL_SECONDS = 10;

/** Shape of the per-user KV record holding an in-flight verification code.
 *
 * rev3: pending email lives ONLY in KV until verify succeeds — `users.email`
 * is not written by request-code. Both display and normalized forms are kept
 * so verify can write the canonical display form back to D1 in one shot.
 */
export interface CodeRecord {
	/** Hex-encoded HMAC-SHA256 of `<userId>:<pendingEmailNormalized>:<code>` keyed by EMAIL_VERIFY_HMAC_KEY. */
	codeHmac: string;
	/** The display form of the pending email (what the user typed, trimmed). Written to users.email on verify success. */
	pendingEmail: string;
	/** The normalized form of the pending email. Used for HMAC, body-mismatch check, and users.email_normalized on verify. */
	pendingEmailNormalized: string;
	/** Unix seconds when the code stops being valid. Defensive — KV TTL is also set. */
	expiresAt: number;
	/** Number of failed attempts so far (0..MAX_ATTEMPTS). */
	attempts: number;
	/** Unix seconds of the last successful send (drives the resend throttle). */
	lastSentAt: number;
}

/** Build the canonical KV key for a user's verification record. */
export function codeKvKey(userId: number): string {
	return `email_verify:${userId}`;
}

/** Build the per-user in-flight send-lock key. Held while we await Dove. */
export function sendLockKvKey(userId: number): string {
	return `email_verify_lock:${userId}`;
}

/**
 * Generate a uniformly-distributed 6-digit numeric code.
 *
 * Uses rejection sampling on `Uint32` to avoid the modulo bias that
 * `crypto.getRandomValues(...) % 1_000_000` would introduce: 2^32 is not
 * an exact multiple of 1_000_000, so the naive approach skews the last
 * `(2^32 mod 1_000_000) ≈ 704_672` values. We discard samples in that
 * unfair tail and re-roll. Expected loops ≈ 1.0002 — effectively never
 * blocks, but distributionally clean.
 */
export function generateCode(): string {
	const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
	const buf = new Uint32Array(1);
	let n: number;
	// Loop bounded by chance — see expected-loops note above.
	while (true) {
		crypto.getRandomValues(buf);
		n = buf[0];
		if (n < limit) break;
	}
	return String(n % 1_000_000).padStart(6, "0");
}

/** Compute the canonical HMAC fingerprint for a (userId, email, code) triple. */
export async function computeCodeHmac(
	hmacKey: string,
	userId: number,
	emailNormalized: string,
	code: string,
): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(hmacKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign(
		"HMAC",
		key,
		enc.encode(`${userId}:${emailNormalized}:${code}`),
	);
	return bytesToHex(new Uint8Array(sig));
}

/**
 * Constant-time string comparison.
 *
 * Both inputs MUST be hex strings of the same length (64 chars for SHA-256).
 * If lengths differ we still walk the longer string to avoid leaking length
 * via timing — but we always return `false` in that case.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
	const len = Math.max(a.length, b.length);
	let diff = a.length ^ b.length;
	for (let i = 0; i < len; i++) {
		diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	}
	return diff === 0;
}

/** Mask an email for display: `username@host` → `u***@host`. */
export function maskEmail(email: string): string {
	const at = email.lastIndexOf("@");
	if (at <= 0) return "***";
	const local = email.slice(0, at);
	const domain = email.slice(at + 1);
	const head = local.slice(0, 1);
	return `${head}***@${domain}`;
}

/** Validate an email per RFC-ish loose rules (docs/17 §7.1). */
export function isValidEmail(email: string): boolean {
	if (!email || email.length > 254) return false;
	// Local@domain.tld — at least one dot in the domain, no whitespace.
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Normalize an email for storage and comparison. */
export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function bytesToHex(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) {
		s += bytes[i].toString(16).padStart(2, "0");
	}
	return s;
}
