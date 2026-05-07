/**
 * Admin badge variant mapping — single source of truth for the colour
 * scheme of every status/role/type pill in the admin console.
 *
 * Pure module: imports nothing from React or `@ellie/ui`. Each helper
 * returns an `AdminBadgeVariant` that the call site passes straight to
 * `<Badge variant={...}>`. The goal is to eliminate ad-hoc Tailwind
 * classes (e.g. raw `bg-yellow-100/text-yellow-800` and inline
 * `text-success border-success/50`) and the white "transparent" look
 * that comes from misusing `outline` for actual status.
 *
 * Convention:
 *  - `success`  — positive / active / resolved
 *  - `warning`  — pending / sticky (needs attention, but not destructive)
 *  - `destructive` — banned / blocked / hard violation
 *  - `secondary` — neutral default (visible chip, not transparent)
 *  - `muted`    — archived / dismissed / quiet but present
 *  - `default`  — primary highlight (group / first-post marker)
 *  - `outline`  — reserved for low-priority structural labels only;
 *                 must NOT be used to communicate state.
 */

export type AdminBadgeVariant =
	| "default"
	| "secondary"
	| "destructive"
	| "success"
	| "warning"
	| "muted"
	| "outline";

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Map a numeric user `status` column to a badge variant.
 *  - 1 (normal)     → success
 *  - -1 (banned)    → destructive
 *  - -2 (archived)  → muted
 *  - -99 (tombstone)→ muted   (unified with archived; previously `outline`
 *                              which rendered as a transparent white pill)
 */
export function userStatusVariant(status: number): AdminBadgeVariant {
	switch (status) {
		case -1:
			return "destructive";
		case -2:
			return "muted";
		case -99:
			return "muted";
		default:
			return "success";
	}
}

/**
 * Map a numeric user `role` column to a badge variant.
 *  - 1 (admin)     → destructive  (highest privilege; signals risk on actions)
 *  - 2 (supermod)  → warning
 *  - 3 (mod)       → default
 *  - other         → secondary    (regular member; replaces `outline` so the
 *                                   chip has a visible background)
 */
export function userRoleVariant(role: number): AdminBadgeVariant {
	switch (role) {
		case 1:
			return "destructive";
		case 2:
			return "warning";
		case 3:
			return "default";
		default:
			return "secondary";
	}
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** Sticky level (>0) → warning; 0 → muted (caller usually hides at 0). */
export function threadStickyVariant(level: number): AdminBadgeVariant {
	return level > 0 ? "warning" : "muted";
}

/** Digest level (>0) → success; 0 → muted. */
export function threadDigestVariant(level: number): AdminBadgeVariant {
	return level > 0 ? "success" : "muted";
}

/** Closed flag (>0) → destructive; 0 → muted. */
export function threadClosedVariant(closed: number): AdminBadgeVariant {
	return closed > 0 ? "destructive" : "muted";
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/** Report `status` text → variant. Replaces the raw STATUS_COLORS map. */
export function reportStatusVariant(
	status: "pending" | "resolved" | "dismissed",
): AdminBadgeVariant {
	switch (status) {
		case "pending":
			return "warning";
		case "resolved":
			return "success";
		case "dismissed":
			return "muted";
	}
}

/**
 * Report target `type` → variant. All three categories are structural
 * labels (not state) so we use distinct visible variants instead of
 * `outline`, which previously rendered as a colourless border on white.
 */
export function reportTypeVariant(type: "thread" | "post" | "user"): AdminBadgeVariant {
	switch (type) {
		case "thread":
			return "default";
		case "post":
			return "secondary";
		case "user":
			return "warning";
	}
}

// ---------------------------------------------------------------------------
// Forums
// ---------------------------------------------------------------------------

/** Forum status: 1 (visible) → success; 0 (hidden) → muted. */
export function forumStatusVariant(status: number): AdminBadgeVariant {
	return status === 1 ? "success" : "muted";
}

/**
 * Forum hierarchy `type` → variant. These are structural taxonomy
 * labels; reviewer asked that `outline` be removed everywhere it was
 * used to look like state, so we map each level to a distinct visible
 * variant. `group` is the highlight, `forum` is the default visible
 * pill, `sub` uses muted to read as "lower in the tree".
 */
export function forumTypeVariant(type: "group" | "forum" | "sub"): AdminBadgeVariant {
	switch (type) {
		case "group":
			return "default";
		case "forum":
			return "secondary";
		case "sub":
			return "muted";
	}
}

// ---------------------------------------------------------------------------
// Censor words
// ---------------------------------------------------------------------------

/** Censor word action: ban → destructive; replace → secondary. */
export function censorActionVariant(action: "ban" | "replace"): AdminBadgeVariant {
	return action === "ban" ? "destructive" : "secondary";
}

// ---------------------------------------------------------------------------
// IP bans
// ---------------------------------------------------------------------------

/** IP-check result: banned → destructive; clear → success. */
export function ipBanStateVariant(banned: boolean): AdminBadgeVariant {
	return banned ? "destructive" : "success";
}

/** Permanent ban marker (no expiry) → warning. */
export function ipBanExpiryVariant(hasExpiry: boolean): AdminBadgeVariant {
	return hasExpiry ? "muted" : "warning";
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/** First-post / 楼主 marker. */
export const FIRST_POST_VARIANT: AdminBadgeVariant = "default";

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Statistics task completion marker. */
export const STATISTICS_DONE_VARIANT: AdminBadgeVariant = "success";
