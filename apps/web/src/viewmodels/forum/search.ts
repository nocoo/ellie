// viewmodels/forum/search.ts — Search page pure logic (simplified)

/** Check if a search query is valid (>= 2 chars after trim). */
export function isValidSearchQuery(query: string): boolean {
	return query.trim().length >= 2;
}
