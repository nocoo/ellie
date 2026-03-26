// viewmodels/forum/search.ts — Search page ViewModel
// Ref: 04d §搜索 — title prefix / author name search

import type { Repositories } from "@/data/index";
import type { PaginatedResult, ThreadSearchParams } from "@/data/repositories/types";
import type { Thread } from "@/models/types";

export type SearchType = "title" | "author";

export interface SearchParams {
	query: string;
	searchType: SearchType;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}

/**
 * Build ThreadSearchParams from search input.
 * Pure function, exported for testing.
 */
export function buildSearchParams(params: SearchParams): ThreadSearchParams {
	const base: ThreadSearchParams = {
		cursor: params.cursor,
		direction: params.direction,
		limit: params.limit ?? 20,
	};

	if (params.searchType === "title") {
		return { ...base, titlePrefix: params.query };
	}
	return { ...base, authorName: params.query };
}

/**
 * Check if search query is valid (non-empty, reasonable length).
 * Pure function, exported for testing.
 */
export function isValidSearchQuery(query: string): boolean {
	const trimmed = query.trim();
	return trimmed.length >= 1 && trimmed.length <= 50;
}

/**
 * Execute search.
 */
export async function executeSearch(
	repos: Repositories,
	params: SearchParams,
): Promise<PaginatedResult<Thread>> {
	if (!isValidSearchQuery(params.query)) {
		return { items: [], nextCursor: null, prevCursor: null, total: 0 };
	}

	const searchParams = buildSearchParams(params);
	return repos.threads.search(searchParams);
}
