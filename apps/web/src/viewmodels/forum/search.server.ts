// viewmodels/forum/search.server.ts — Server-only data loader for search
// Calls FTS5 search API on Worker

import "server-only";

import type { PaginatedResult } from "@/viewmodels/shared/pagination";
import { forumApi } from "@/lib/forum-api";
import type { Thread } from "@ellie/types";

export interface SearchData {
	query: string;
	results: PaginatedResult<Thread>;
	disabled?: boolean; // true when search is disabled by admin
}

/** Settings map type for search-related keys */
interface SettingsMap {
	"general.search.enabled"?: boolean;
}

/**
 * Check if search feature is enabled via settings endpoint.
 * This is a lightweight check that reads from KV-cached settings,
 * avoiding the overhead of a real FTS5 query.
 */
async function isSearchEnabled(): Promise<boolean> {
	try {
		const response = await forumApi.get<SettingsMap>("/api/v1/settings", {
			prefix: "general.search",
		});
		// Default to true if setting doesn't exist
		return response.data["general.search.enabled"] !== false;
	} catch {
		// On error, assume search is enabled (fail open for availability)
		return true;
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
