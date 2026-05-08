// userTombstone.ts — D4-a: pure helper for tombstoning a user row.
//
// Scope (D4-a):
//   - Compute the field map a tombstone UPDATE should set, given the target
//     user id + actor admin id + a clock function.
//   - Build a single D1PreparedStatement that applies that update.
//
// Out of scope here (handled in D4-b/D4-c):
//   - Deleting threads / posts / post_comments / attachments / messages.
//   - R2 cleanup.
//   - Counter recalculation on affected forums/threads/users.
//   - Cache invalidation (forum-volatile / user cache).
//   - Logging into admin_logs.
//
// The handler in D4-a will NOT call this helper on the success path (purge
// stays at 501 NOT_IMPLEMENTED until D4-b). Coverage comes from this file's
// unit tests so the field map + statement shape can be reviewed in isolation
// before any production write path uses them.
//
// Reset rules — derived from the live users schema (apps/worker/migrations/
// 0000_init_schema.sql + 0024/0026/0027/0028). Every tombstoned column is
// NOT NULL in the schema, so we use empty string for TEXT and 0 for INTEGER
// rather than NULL. status sentinel is -99 ("已清除"); role goes to 0 to
// drop any staff semantics; username gets a deterministic, unique marker
// `[已删除#<id>]` so the UNIQUE(username) constraint stays satisfied while
// the row remains visible to admins/audit.

import type { Env } from "./env";

export const TOMBSTONE_STATUS = -99;

/**
 * Marker username assigned to tombstoned users. Stable, unique per id.
 * Format intentionally avoids `@` / spaces so it round-trips through
 * existing username validators if anything else queries it.
 */
export function tombstoneUsername(userId: number): string {
	return `[已删除#${userId}]`;
}

/**
 * Build the column → value map a tombstone UPDATE should set on `users`.
 *
 * @param userId    target user id (used to mint the marker username)
 * @param actorId   admin user id issuing the purge (recorded in purged_by)
 * @param nowSec    unix seconds at the moment of purge (recorded in purged_at)
 *
 * Pure function — no env / DB dependency, easy to assert in unit tests.
 */
export function buildTombstoneFields(
	userId: number,
	actorId: number,
	nowSec: number,
): Record<string, string | number> {
	return {
		// Identity / display
		username: tombstoneUsername(userId),
		email: "",
		password_hash: "",
		password_salt: "",
		avatar: "",
		avatar_path: "",

		// Status / role / tombstone columns
		status: TOMBSTONE_STATUS,
		role: 0,
		purged_at: nowSec,
		purged_by: actorId,

		// Counters (target tombstone is the canonical zero — collateral
		// counters are fixed up by D4-b's content-deletion path).
		threads: 0,
		posts: 0,
		credits: 0,
		coins: 0,
		digest_posts: 0,

		// Profile / display fields (cleared so PII does not leak via admin views)
		signature: "",
		group_title: "",
		group_color: "",
		group_stars: 0,
		custom_title: "",
		ol_time: 0,
		gender: 0,
		birth_year: 0,
		birth_month: 0,
		birth_day: 0,
		reside_province: "",
		reside_city: "",
		graduate_school: "",
		bio: "",
		interest: "",
		qq: "",
		site: "",
		last_activity: 0,

		// Auxiliary profile (campus + has_avatar were added in 0024/0026)
		campus: "",
		has_avatar: 0,

		// Email verification snapshot
		email_verified_at: 0,
		email_normalized: "",
		email_changed_at: 0,

		// IP audit trail
		reg_ip: "",
		last_ip: "",

		// Note: id, reg_date, last_login intentionally preserved — id is the
		// FK anchor; reg_date / last_login are kept as audit timestamps.
	};
}

/**
 * Build a single `UPDATE users SET ... WHERE id = ?` D1PreparedStatement
 * from the field map above. Caller is responsible for placing this into a
 * D1 batch (or running it standalone). NOT executed by D4-a's purge handler.
 */
export function buildTombstoneStatement(
	env: Env,
	userId: number,
	actorId: number,
	nowSec: number,
): D1PreparedStatement {
	const fields = buildTombstoneFields(userId, actorId, nowSec);
	const cols = Object.keys(fields);
	const setClause = cols.map((c) => `${c} = ?`).join(", ");
	const values = cols.map((c) => fields[c]);
	return env.DB.prepare(`UPDATE users SET ${setClause} WHERE id = ?`).bind(...values, userId);
}
