/**
 * Admin badge tone mapping — single source of truth for the colour
 * scheme of every status/role/type pill in the admin console.
 *
 * Pure module: imports nothing from React or Basalt. Each helper
 * returns an `AdminBadgeVariant` (mapped to Basalt `BadgeTone`) that
 * the call site passes to `<Badge tone={...}>`.
 *
 * Convention:
 *  - `success` — positive / active / resolved
 *  - `warning` — pending / sticky (needs attention, but not danger)
 *  - `danger`  — banned / blocked / hard violation
 *  - `neutral` — muted default (visible chip, not transparent)
 *  - `info`    — primary highlight (group / first-post marker)
 */

export type AdminBadgeVariant = "info" | "neutral" | "danger" | "success" | "warning";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Map a numeric user `status` column to a badge tone.
 *  - 1 (normal)     → success
 *  - -1 (banned)    → danger
 *  - -2 (archived)  → neutral
 *  - -99 (tombstone)→ neutral
 */
export function userStatusVariant(status: number): AdminBadgeVariant {
	switch (status) {
		case -1:
			return "danger";
		case -2:
			return "neutral";
		case -99:
			return "neutral";
		default:
			return "success";
	}
}

/**
 * Map a numeric user `role` column to a badge tone.
 *  - 1 (admin)     → danger
 *  - 2 (supermod)  → warning
 *  - 3 (mod)       → info
 *  - other         → neutral
 */
export function userRoleVariant(role: number): AdminBadgeVariant {
	switch (role) {
		case 1:
			return "danger";
		case 2:
			return "warning";
		case 3:
			return "info";
		default:
			return "neutral";
	}
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** Sticky level (>0) → warning; 0 → neutral (caller usually hides at 0). */
export function threadStickyVariant(level: number): AdminBadgeVariant {
	return level > 0 ? "warning" : "neutral";
}

/** Digest level (>0) → success; 0 → neutral. */
export function threadDigestVariant(level: number): AdminBadgeVariant {
	return level > 0 ? "success" : "neutral";
}

/** Closed flag (>0) → danger; 0 → neutral. */
export function threadClosedVariant(closed: number): AdminBadgeVariant {
	return closed > 0 ? "danger" : "neutral";
}

/**
 * Highlight is an encoded RGB+style bitmask (see worker `encodeHighlight`),
 * so the tone only differentiates "set" vs "unset" — any non-zero value
 * means a custom title style was applied.
 */
export function threadHighlightVariant(highlight: number): AdminBadgeVariant {
	return highlight > 0 ? "info" : "neutral";
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Report `status` text → tone. */
export function reportStatusVariant(
	status: "pending" | "resolved" | "dismissed",
): AdminBadgeVariant {
	switch (status) {
		case "pending":
			return "warning";
		case "resolved":
			return "success";
		case "dismissed":
			return "neutral";
	}
}

/** Report target `type` → tone. */
export function reportTypeVariant(type: "thread" | "post" | "user"): AdminBadgeVariant {
	switch (type) {
		case "thread":
			return "info";
		case "post":
			return "neutral";
		case "user":
			return "warning";
	}
}

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------

/** Forum status: 1 (visible) → success; 0 (hidden) → neutral. */
export function forumStatusVariant(status: number): AdminBadgeVariant {
	return status === 1 ? "success" : "neutral";
}

/** Forum hierarchy `type` → tone. */
export function forumTypeVariant(type: "group" | "forum" | "sub"): AdminBadgeVariant {
	switch (type) {
		case "group":
			return "info";
		case "forum":
			return "neutral";
		case "sub":
			return "neutral";
	}
}

// ---------------------------------------------------------------------------
// Censor words
// ---------------------------------------------------------------------------

/** Censor word action: ban → danger; replace → neutral. */
export function censorActionVariant(action: "ban" | "replace"): AdminBadgeVariant {
	return action === "ban" ? "danger" : "neutral";
}

// ---------------------------------------------------------------------------
// IP bans
// ---------------------------------------------------------------------------

/** IP-check result: banned → danger; clear → success. */
export function ipBanStateVariant(banned: boolean): AdminBadgeVariant {
	return banned ? "danger" : "success";
}

/** Permanent ban marker (no expiry) → warning. */
export function ipBanExpiryVariant(hasExpiry: boolean): AdminBadgeVariant {
	return hasExpiry ? "neutral" : "warning";
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** First-post / 楼主 marker. */
export const FIRST_POST_VARIANT: AdminBadgeVariant = "info";

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Statistics task completion marker. */
export const STATISTICS_DONE_VARIANT: AdminBadgeVariant = "success";
