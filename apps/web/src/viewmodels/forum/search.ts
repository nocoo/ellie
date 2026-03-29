// viewmodels/forum/search.ts — Search page pure logic
// Ref: 04d §Search — search type resolution, param building

import type { ThreadSearchParams } from "@ellie/repositories";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SearchType = "title" | "author";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Resolve search type from raw URL param value. */
export function resolveSearchType(raw: string | undefined): SearchType {
	if (raw === "author") return "author";
	return "title";
}

/** Build ThreadSearchParams based on search type and query. */
export function buildSearchParams(type: SearchType, query: string): ThreadSearchParams {
	if (type === "author") {
		return { authorName: query };
	}
	return { titlePrefix: query };
}

/** Check if a search query is valid (non-empty after trim). */
export function isValidSearchQuery(query: string): boolean {
	return query.trim().length > 0;
}
