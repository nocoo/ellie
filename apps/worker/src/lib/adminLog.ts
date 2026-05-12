// adminLog.ts — F1: write-side helper for the admin_logs audit trail.
//
// Scope (F1):
//   - resolveActor(request, env): pull (adminId, adminName, ip) from proxy headers,
//     falling back to the system actor (id=0, name="system") when the call did
//     not come through the Next admin proxy.
//   - sanitizeAdminLogDetails(input): turn a handler-provided details object
//     into a safe JSON string. Rejects non-object input, recursively redacts
//     a fixed denylist of keys, caps depth, and clamps the encoded byte length.
//   - writeAdminLog(env, actor, params): one row INSERT with light shape
//     validation. Best-effort — never throws back to the caller; failures are
//     logged via console.error so the audit miss is observable.
//
// Out of scope (F1):
//   - Any business-handler integration (F3-a/b/c).
//   - Failure-path audit (e.g. user.ban_failed). If we want that later it will
//     be a separate action; F1 only writes after the mutation succeeds.

import { extractTrustedClientIp } from "./clientIp";
import type { Env } from "./env";

// ─── Constants ────────────────────────────────────────────────────

export const SYSTEM_ACTOR_ID = 0;
export const SYSTEM_ACTOR_NAME = "system";

const DETAILS_MAX_BYTES = 4096;
const DETAILS_MAX_DEPTH = 4;

const ACTION_MAX_LEN = 64;
const TARGET_TYPE_MAX_LEN = 32;

/**
 * Exact-match denylist of details keys whose values are always replaced with
 * `[REDACTED]`. Comparison is lower-cased so callers do not have to worry
 * about casing. We deliberately use exact match (after lower-casing) instead
 * of a regex so audit-allowed fields like `actorEmail` / `emailNormalized`
 * are NOT swept up.
 */
const REDACT_KEY_DENYLIST = new Set<string>([
	"password",
	"passwordhash",
	"password_hash",
	"token",
	"secret",
	"apikey",
	"api_key",
	"api-key",
	"cookie",
	"authorization",
	"email", // bare `email` — but `actorEmail`, `emailNormalized` etc. pass through
]);

const REDACTED = "[REDACTED]";

// ─── Actor resolution ────────────────────────────────────────────

export interface AdminLogActor {
	adminId: number;
	adminName: string;
	adminEmail: string;
	ip: string;
}

/**
 * Pull the admin actor out of a Worker request.
 *
 * The Next admin proxy injects `X-Admin-Actor-Email` / `X-Admin-Actor-Name`
 * on mutation calls (see `apps/admin/src/lib/admin-api.ts` `adminApiAs`).
 * Direct Worker calls authenticated only by Key B carry no headers and are
 * recorded as the system actor.
 *
 * IP precedence: delegated to `extractTrustedClientIp(request, env)` so admin
 * BFF mutations carry the originating admin's IP via `X-Real-IP` (only trusted
 * when the request is server-to-Worker, i.e. carries Key A/B). Empty string is
 * accepted — better to log "IP unknown" than a forged value.
 * Name precedence: `X-Admin-Actor-Name` → full `X-Admin-Actor-Email` → "system".
 * Email: trimmed `X-Admin-Actor-Email`, or "" when absent. The full address is
 * preserved (no local-part extraction) so audit consumers can rebuild the
 * `mailto:` / contact link verbatim.
 *
 * adminId stays at 0 because admin sessions are email-keyed (no numeric
 * users.id available); the email is preserved alongside via adminEmail and
 * persisted into details.actorEmail by writeAdminLog().
 */
export function resolveActor(request: Request, env: Env): AdminLogActor {
	const headerEmail = request.headers.get("X-Admin-Actor-Email")?.trim() ?? "";
	const headerName = request.headers.get("X-Admin-Actor-Name")?.trim() ?? "";

	const adminName = headerName || headerEmail || SYSTEM_ACTOR_NAME;

	const ip = extractTrustedClientIp(request, env) ?? "";

	return {
		adminId: SYSTEM_ACTOR_ID,
		adminName,
		adminEmail: headerEmail,
		ip,
	};
}

// ─── Details sanitization ────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function shouldRedact(key: string): boolean {
	return REDACT_KEY_DENYLIST.has(key.toLowerCase());
}

/**
 * Walk the input and redact denylisted keys at every depth. Beyond
 * DETAILS_MAX_DEPTH the subtree is collapsed to the literal string
 * `"[DEPTH_LIMIT]"` so nothing surprising lands in the JSON.
 */
function redactDeep(value: unknown, depth: number): unknown {
	if (depth > DETAILS_MAX_DEPTH) return "[DEPTH_LIMIT]";
	if (Array.isArray(value)) {
		return value.map((v) => redactDeep(v, depth + 1));
	}
	if (isPlainObject(value)) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) {
			out[k] = shouldRedact(k) ? REDACTED : redactDeep(v, depth + 1);
		}
		return out;
	}
	return value;
}

function utf8ByteLength(s: string): number {
	return new TextEncoder().encode(s).byteLength;
}

/**
 * Convert handler-supplied details into a safe JSON string suitable for the
 * `admin_logs.details` column. Top level must be a plain object; arrays /
 * scalars / null collapse to `"{}"` so handlers can't smuggle non-object
 * payloads. Nested arrays are fine (they may appear as object values).
 *
 * Truncation strategy: if the encoded byte length exceeds DETAILS_MAX_BYTES,
 * return `{"truncated":true,"head":"<prefix>"}` where the prefix is itself
 * a UTF-8 byte slice of the original payload, kept short enough that the
 * envelope still fits in the cap.
 */
export function sanitizeAdminLogDetails(input: unknown): string {
	if (!isPlainObject(input)) return "{}";

	const cleaned = redactDeep(input, 1) as Record<string, unknown>;

	let serialized: string;
	try {
		serialized = JSON.stringify(cleaned);
	} catch {
		return "{}";
	}

	if (utf8ByteLength(serialized) <= DETAILS_MAX_BYTES) {
		return serialized;
	}

	// Truncate by characters first, then verify byte length, shrinking until
	// the wrapping envelope also fits. The prefix is intentionally NOT parsed
	// back as JSON — it's an opaque snippet for human inspection.
	const envelopeOverhead = utf8ByteLength('{"truncated":true,"head":""}');
	let cutChars = Math.max(0, DETAILS_MAX_BYTES - envelopeOverhead);
	let head = serialized.slice(0, cutChars);
	while (utf8ByteLength(JSON.stringify({ truncated: true, head })) > DETAILS_MAX_BYTES) {
		cutChars = Math.max(0, cutChars - 64);
		head = serialized.slice(0, cutChars);
		if (cutChars === 0) break;
	}
	return JSON.stringify({ truncated: true, head });
}

// ─── Insert helper ────────────────────────────────────────────────

export interface WriteAdminLogParams {
	action: string;
	targetType: string;
	targetId: number | null;
	details?: unknown;
}

function isNonEmptyString(v: unknown, max: number): v is string {
	return typeof v === "string" && v.length > 0 && v.length <= max;
}

function isValidTargetId(v: unknown): v is number | null {
	if (v === null) return true;
	return typeof v === "number" && Number.isInteger(v);
}

/**
 * Insert one row into admin_logs. Best-effort:
 *   - Validates action / targetType / targetId shape; bails early on bad input.
 *   - Catches DB errors and logs them via console.error; never re-throws.
 *
 * Call sites MUST invoke this only after the underlying mutation has been
 * committed. Failure-path audit is out of scope for F1.
 */
export async function writeAdminLog(
	env: Env,
	actor: AdminLogActor,
	params: WriteAdminLogParams,
): Promise<void> {
	if (!isNonEmptyString(params.action, ACTION_MAX_LEN)) {
		console.error("[adminLog] invalid action", { action: params.action });
		return;
	}
	if (!isNonEmptyString(params.targetType, TARGET_TYPE_MAX_LEN)) {
		console.error("[adminLog] invalid targetType", { targetType: params.targetType });
		return;
	}
	if (!isValidTargetId(params.targetId)) {
		console.error("[adminLog] invalid targetId", { targetId: params.targetId });
		return;
	}

	// Auto-merge actor email into details so audit consumers (UI tooltip, F4)
	// can rebuild the contact link without a schema migration. Only merged when
	// the actor carries an email — system actor (empty email) leaves details
	// alone so we don't pollute rows with `"actorEmail":""`.
	const baseDetails = isPlainObject(params.details) ? params.details : {};
	const mergedDetails = actor.adminEmail
		? { ...baseDetails, actorEmail: actor.adminEmail }
		: params.details;
	const detailsJson = sanitizeAdminLogDetails(mergedDetails);
	const nowSec = Math.floor(Date.now() / 1000);

	try {
		await env.DB.prepare(
			"INSERT INTO admin_logs (admin_id, admin_name, action, target_type, target_id, details, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(
				actor.adminId,
				actor.adminName,
				params.action,
				params.targetType,
				params.targetId,
				detailsJson,
				actor.ip,
				nowSec,
			)
			.run();
	} catch (err) {
		// Audit miss — do not fail the mutation response.
		console.error("[adminLog] INSERT failed", {
			action: params.action,
			targetType: params.targetType,
			targetId: params.targetId,
			err,
		});
	}
}
