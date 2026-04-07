// viewmodels/forum/search.server.ts — Server-only data loader for search
// Calls FTS5 search API on Worker

import "server-only";

import type { PaginatedResult } from "@/viewmodels/shared/pagination";
import { ForumApiError, forumApi } from "@/lib/forum-api";
import type { Thread } from "@ellie/types";

export interface SearchData {
	query: string;
	results: PaginatedResult<Thread>;
	disabled?: boolean; // true when search is disabled by admin
}

/**
 * Check if search feature is enabled by probing the API.
 * Returns true if enabled, false if disabled (FEATURE_DISABLED).
 * Throws on other errors (maintenance, network, etc).
 */
async function isSearchEnabled(): Promise<boolean> {
	try {
		// Probe with minimal valid query
		await forumApi.getCursor<Thread>("/api/v1/search/threads", {
			q: "aa", // minimum 2 chars
			limit: 1,
		});
		return true;
	} catch (err) {
		if (err instanceof ForumApiError && err.code === "FEATURE_DISABLED") {
			return false;
		}
		// Re-throw other errors (maintenance, network, etc)
		throw err;
	}
}

export async function loadSearchResults(params: {
	query?: string;
	cursor?: string;
	limit?: number;
}): Promise<SearchData> {
	const query = params.query?.trim() ?? "";
	const limit = params.limit ?? 20;

	// Check if search is enabled first (for all requests, even empty queries)
	// This ensures "搜索功能暂时关闭" shows on page load when disabled
	const enabled = await isSearchEnabled();
	if (!enabled) {
		return {
			query,
			results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
			disabled: true,
		};
	}

	// Empty or too short query: return empty results (UI shows prompt)
	// Note: Worker returns 400 for < 2 chars, but we silently handle it in UI layer
	if (!query || query.length < 2) {
		return {
			query,
			results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
		};
	}

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
}
