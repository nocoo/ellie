// viewmodels/forum/digest.server.ts — Server-only data loader for digest page
// Calls Worker API: GET /api/v1/digest, GET /api/v1/digest/stats

import "server-only";

import { forumApi } from "@/lib/forum-api";
import { getPageSize } from "@/lib/forum-settings";
import type { PaginatedResult } from "@/viewmodels/shared/pagination";
import type { Thread } from "@ellie/types";

export interface DigestStats {
	total: number;
	level1: number;
	level2: number;
	level3: number;
}

export interface DigestData {
	results: PaginatedResult<Thread>;
	stats: DigestStats;
}

export async function loadDigestList(params: {
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
	forumId?: number;
	level?: number; // Filter by digest level (1, 2, or 3)
}): Promise<DigestData> {
	// Get page size from settings
	const defaultLimit = await getPageSize();
	const limit = params.limit ?? defaultLimit;

	// Build query params
	const queryParams: Record<string, string | number | boolean | null | undefined> = {
		limit,
		cursor: params.cursor,
		forumId: params.forumId,
	};
	if (params.level && params.level >= 1 && params.level <= 3) {
		queryParams.level = params.level;
	}

	// Fetch digest threads and stats in parallel
	const [threadsRes, statsRes] = await Promise.all([
		forumApi.getCursor<Thread>("/api/v1/digest", queryParams),
		forumApi.get<DigestStats>("/api/v1/digest/stats"),
	]);

	return {
		results: {
			items: threadsRes.data,
			nextCursor: threadsRes.meta.nextCursor,
			prevCursor: params.cursor ?? null,
			total: statsRes.data.total,
		},
		stats: statsRes.data,
	};
}
