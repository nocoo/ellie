// viewmodels/forum/search.server.ts — Server-only data loader for search
// Calls FTS5 search API on Worker

import "server-only";

import { ForumApiError, forumApi } from "@/lib/forum-api";
import type { Thread } from "@ellie/types";
import type { PaginatedResult } from "@/viewmodels/shared/pagination";

export interface SearchData {
	query: string;
	results: PaginatedResult<Thread>;
	disabled?: boolean; // true when search is disabled by admin
}

export async function loadSearchResults(params: {
	query?: string;
	cursor?: string;
	limit?: number;
}): Promise<SearchData> {
	const query = params.query?.trim() ?? "";
	const limit = params.limit ?? 20;

	// Empty or too short query: return empty results (UI shows prompt)
	// Note: Worker returns 400 for < 2 chars, but we silently handle it in UI layer
	if (!query || query.length < 2) {
		return {
			query,
			results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
		};
	}

	try {
		// Title search: call FTS5 API
		const response = await forumApi.getCursor<Thread>("/api/v1/search/threads", {
			q: query,
			limit,
			cursor: params.cursor,
		});

		return {
			query,
			results: {
				items: response.data,
				nextCursor: response.meta.nextCursor,
				prevCursor: null, // FTS5 keyset pagination is forward-only
				total: (response.meta as { total?: number }).total ?? 0,
			},
		};
	} catch (err) {
		// Handle search disabled (503 FEATURE_DISABLED)
		if (err instanceof ForumApiError && err.status === 503) {
			return {
				query,
				results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
				disabled: true,
			};
		}
		throw err;
	}
}
