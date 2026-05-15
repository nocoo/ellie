// Shared typeId resolution / validation for the public thread surface
// (GET /api/v1/threads filter, POST /api/v1/threads create).
//
// Reviewer pin (msg b03d4af3 / 4b64ac64 / 11e374e8):
//   - typeId is always paired with a forumId; a typeId without forumId
//     is a 400 (caller bug, not a row-not-found).
//   - When the forum has `thread_types_enabled = 0`, any non-zero typeId
//     is rejected (400) — admin must enable thread types on the forum
//     before any row is reachable.
//   - typeId only resolves against `forum_thread_types` rows that are
//     `enabled = 1` and live in the SAME forum (forum_id = ?).
//     Tombstoned rows (enabled = 0) and cross-forum ids are 400.
//   - typeId on the wire is the SYNTHETIC global id minted by 0039.
//     `source_typeid` is admin/debug only and never exposed here.
//
// The helper returns one of three flavours so callers can shape the
// 4xx response without re-deriving the reason:
//   - { kind: "ok", row } — caller may use row.id and row.name (denorm)
//   - { kind: "noTypeRequested" } — caller passed null/undefined; only
//     legal on the create path when the forum doesn't require it
//   - { kind: "invalid", reason, message } — caller turns into 400
//
// "noTypeRequested" is intentionally separate from "invalid" so the
// list path (where missing typeId means "no filter") can short-circuit
// without firing the D1 query, while the create path can still enforce
// "required" rules after the fact.

import type { Env } from "./env";

/** Row shape returned to callers on success. */
export interface ResolvedThreadType {
	/** Synthetic global id minted by 0039. Same value the caller passed in. */
	id: number;
	/** Forum scope. Always equals the `forumId` the caller passed in. */
	forumId: number;
	/** Display name. Used by the create path as `threads.type_name` denorm cache. */
	name: string;
}

/** Discriminated result. */
export type ThreadTypeResolution =
	| { kind: "ok"; row: ResolvedThreadType }
	| { kind: "noTypeRequested" }
	| { kind: "invalid"; reason: ThreadTypeInvalidReason; message: string };

/**
 * Why a typeId was rejected. Carried back so the handler can decide on
 * an error code; the wire-level error code stays "INVALID_REQUEST" /
 * "INVALID_BODY" depending on the call site.
 */
export type ThreadTypeInvalidReason =
	| "missingForumId" // typeId provided without forumId
	| "notInteger" // raw input could not be parsed as a non-negative integer
	| "forumDisabled" // forum.thread_types_enabled = 0 but typeId !== 0
	| "notFound"; // (forumId, typeId) does not match an enabled row

/**
 * Forum config slice the resolver needs. Caller normally has this on
 * hand (`forum:meta:v2` / D1 SELECT), so we accept it injected to avoid
 * a redundant fetch.
 */
export interface ForumThreadTypesGate {
	/** Mirrors `forums.thread_types_enabled` (1 = enabled). */
	enabled: boolean;
}

/**
 * Coerce a query-string / body input into a non-negative integer typeId,
 * or `null` if the input was absent (`undefined` / `null` / `""`).
 *
 * Strict parsing — reviewer pin (msg b4221d27): `Number.parseInt` happily
 * eats trailing junk (`"1abc"` → 1, `"1.5"` → 1) which would silently
 * resolve a malformed input to category 1 in both the list filter and
 * the create path. We instead require:
 *   - `undefined` / `null` / `""` → absent (caller decides if missing OK)
 *   - string MUST match `/^(0|[1-9]\d*)$/` — no leading zeros (apart from
 *     bare "0"), no decimal point, no sign, no trailing chars or
 *     whitespace. The query string / JSON body has already trimmed any
 *     transport-layer wrappers; if a caller sends padding it's their bug.
 *   - number MUST be a non-negative integer (no NaN, no fractions, no
 *     negatives, no Infinity).
 *   - everything else (objects, arrays, booleans) → invalid.
 *
 * Returns the discriminated `invalid` shape so the caller can 400 early
 * without dispatching to D1.
 */
export function coerceTypeIdInput(
	raw: unknown,
): { kind: "absent" } | { kind: "ok"; value: number } | { kind: "invalid"; message: string } {
	if (raw === undefined || raw === null) return { kind: "absent" };
	if (typeof raw === "string") {
		if (raw.length === 0) return { kind: "absent" };
		// Strict: bare "0" or non-zero digit string with no leading zero.
		// Rejects "1abc", "1.5", " 1", "1 ", "+1", "-1", "01", "0x1", etc.
		if (!/^(0|[1-9]\d*)$/.test(raw)) {
			return { kind: "invalid", message: "typeId must be a non-negative integer" };
		}
		return { kind: "ok", value: Number.parseInt(raw, 10) };
	}
	if (typeof raw === "number") {
		if (!Number.isInteger(raw) || raw < 0) {
			return { kind: "invalid", message: "typeId must be a non-negative integer" };
		}
		return { kind: "ok", value: raw };
	}
	return { kind: "invalid", message: "typeId must be a non-negative integer" };
}

/**
 * Resolve and validate `typeId` against the forum gate + D1 row.
 *
 * Inputs:
 *   - `forumId` may be `null` to model the "list endpoint with typeId
 *     but no forumId" case — that's an immediate `missingForumId` 400.
 *   - `typeId` is the parsed input. `null`/`undefined` → noTypeRequested.
 *     `0` is treated identically to "no type" (Discuz historical default
 *     for "unclassified"); non-zero values dispatch a row check.
 *   - `forumGate` MUST come from a path that already verified forum
 *     visibility (the public endpoints do this via `forum:meta:v2`); the
 *     resolver only inspects `thread_types_enabled`.
 *
 * D1 cost on the happy path: ONE row read against
 * `idx_forum_thread_types_source` via the (forum_id, source_typeid)
 * index isn't applicable (we look up by synthetic id), so the query
 * uses the primary key — still O(log N).
 */
export async function resolveAndValidateTypeId(
	env: Env,
	forumId: number | null,
	typeId: number | null | undefined,
	forumGate: ForumThreadTypesGate,
): Promise<ThreadTypeResolution> {
	// Treat 0 / null / undefined as "no classification requested".
	if (typeId == null || typeId === 0) return { kind: "noTypeRequested" };

	if (forumId == null) {
		return {
			kind: "invalid",
			reason: "missingForumId",
			message: "typeId requires forumId",
		};
	}

	if (!forumGate.enabled) {
		return {
			kind: "invalid",
			reason: "forumDisabled",
			message: "Forum has thread types disabled",
		};
	}

	// Hard-bind both forum_id AND id so a synthetic id minted in another
	// forum cannot satisfy this lookup. `enabled = 1` filters tombstones.
	const row = await env.DB.prepare(
		`SELECT id, forum_id, name
		 FROM forum_thread_types
		 WHERE id = ? AND forum_id = ? AND enabled = 1`,
	)
		.bind(typeId, forumId)
		.first<{ id: number; forum_id: number; name: string }>();

	if (!row) {
		return {
			kind: "invalid",
			reason: "notFound",
			message: "Thread type not found in this forum",
		};
	}

	return {
		kind: "ok",
		row: { id: row.id, forumId: row.forum_id, name: row.name },
	};
}
