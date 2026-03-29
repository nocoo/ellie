// viewmodels/forum/search.server.ts — Server-only data loader for search
// Ref: 04d §Search — calls ThreadRepository.search with resolved params

import {
	type PaginatedResult,
	type ThreadSearchParams,
	createRepositories,
} from "@ellie/repositories";
import type { Thread } from "@ellie/types";
import { type SearchType, buildSearchParams, resolveSearchType } from "./search";

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

	if (query.length === 0) {
		return {
			query,
			searchType,
			results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
		};
	}

	const repos = createRepositories();
	const searchParams: ThreadSearchParams = {
		...buildSearchParams(searchType, query),
		cursor: params.cursor,
		direction: params.direction ?? "forward",
		limit: params.limit ?? 20,
	};

	const results = (await repos.threads.search(searchParams)) as PaginatedResult<Thread>;

	return { query, searchType, results };
}
