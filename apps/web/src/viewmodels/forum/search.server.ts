// viewmodels/forum/search.server.ts — Server-only data loader for search
// Worker v1 has no search endpoint. Returns empty results for now.

import "server-only";

import type { Thread } from "@ellie/types";
import { type SearchType, resolveSearchType } from "./search";

/** Matches PaginatedResult shape from @ellie/repositories */
interface PaginatedResult<T> {
	items: T[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

export interface SearchData {
	query: string;
	searchType: SearchType;
	results: PaginatedResult<Thread>;
}

export async function loadSearchResults(params: {
	query?: string;
	type?: string;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<SearchData> {
	const query = params.query?.trim() ?? "";
	const searchType = resolveSearchType(params.type);

	// Worker v1 has no search endpoint — always return empty results.
	return {
		query,
		searchType,
		results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
	};
}
