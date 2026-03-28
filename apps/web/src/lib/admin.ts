/**
 * Admin authorization helpers.
 *
 * Admin status is determined by the ADMIN_EMAILS environment variable,
 * a comma-separated list of email addresses (following pew convention).
 */

// ---------------------------------------------------------------------------
// Admin check
// ---------------------------------------------------------------------------

/**
 * Parse the ADMIN_EMAILS env var into a Set of lowercase emails.
 */
function getAdminEmails(): Set<string> {
	const raw = process.env.ADMIN_EMAILS ?? "";
	return new Set(
		raw
			.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean),
	);
}

/**
 * Check if the given email is an admin.
 */
export function isAdmin(email: string | undefined | null): boolean {
	if (!email) return false;
	return getAdminEmails().has(email.toLowerCase());
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
 * Returns null if the session user's email is not in ADMIN_EMAILS.
 */
export function resolveAdmin(
	session: {
		user?: { id?: string; email?: string | null; name?: string | null; image?: string | null };
	} | null,
): AdminInfo | null {
	if (!session?.user) return null;

	if (!isAdmin(session.user.email)) return null;

	return {
		sub: session.user.id ?? "",
		email: session.user.email ?? "",
		name: session.user.name ?? "",
		image: session.user.image ?? undefined,
	};
}
