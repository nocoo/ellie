/**
 * Admin authorization helpers.
 *
 * Admin status is determined by the ADMIN_GOOGLE_IDS environment variable,
 * a comma-separated list of Google `sub` IDs (NOT emails).
 */

// ---------------------------------------------------------------------------
// Admin check
// ---------------------------------------------------------------------------

/**
 * Parse the ADMIN_GOOGLE_IDS env var into a Set of Google sub IDs.
 */
function getAdminGoogleIds(): Set<string> {
	const raw = process.env.ADMIN_GOOGLE_IDS ?? "";
	return new Set(
		raw
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean),
	);
}

/**
 * Check if the given Google sub ID is an admin.
 */
export function isAdminGoogleId(sub: string | undefined | null): boolean {
	if (!sub) return false;
	return getAdminGoogleIds().has(sub);
}

// ---------------------------------------------------------------------------
// Resolve admin from session
// ---------------------------------------------------------------------------

export interface AdminInfo {
	sub: string;
	email: string;
	name: string;
	image?: string;
}

/**
 * Resolve admin info from a session.
 * Returns null if the session user's Google sub is not in ADMIN_GOOGLE_IDS.
 */
export function resolveAdmin(
	session: {
		user?: { id?: string; email?: string | null; name?: string | null; image?: string | null };
	} | null,
): AdminInfo | null {
	if (!session?.user) return null;

	const sub = session.user.id;
	if (!isAdminGoogleId(sub)) return null;

	return {
		sub: sub as string,
		email: session.user.email ?? "",
		name: session.user.name ?? "",
		image: session.user.image ?? undefined,
	};
}
