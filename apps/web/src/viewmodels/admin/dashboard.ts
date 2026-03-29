/**
 * Dashboard types and pure helpers.
 * Client-safe — no server-only imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardStats {
	users: { total: number; today: number; banned: number };
	threads: { total: number; today: number };
	posts: { total: number; today: number };
	forums: { total: number; hidden: number };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse raw stats API response data into DashboardStats.
 * Provides defaults for missing fields.
 */
export function parseDashboardStats(raw: unknown): DashboardStats {
	const data = (raw ?? {}) as Record<string, Record<string, number>>;

	return {
		users: {
			total: data.users?.total ?? 0,
			today: data.users?.today ?? 0,
			banned: data.users?.banned ?? 0,
		},
		threads: {
			total: data.threads?.total ?? 0,
			today: data.threads?.today ?? 0,
		},
		posts: {
			total: data.posts?.total ?? 0,
			today: data.posts?.today ?? 0,
		},
		forums: {
			total: data.forums?.total ?? 0,
			hidden: data.forums?.hidden ?? 0,
		},
	};
}

/**
 * Compute active forums count (total - hidden).
 */
export function activeForums(stats: DashboardStats): number {
	return stats.forums.total - stats.forums.hidden;
}
