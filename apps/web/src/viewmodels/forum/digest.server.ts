// viewmodels/forum/digest.server.ts — Server-only data loader for digest page
// Calls Worker API: GET /api/v1/digest, GET /api/v1/digest/stats

import "server-only";

import { forumApi } from "@/lib/forum-api";
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

const DIGEST_LIMIT = 20;

export async function loadDigestList(params: {
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
	forumId?: number;
}): Promise<DigestData> {
	const limit = params.limit ?? DIGEST_LIMIT;

	// Fetch digest threads and stats in parallel
	const [threadsRes, statsRes] = await Promise.all([
		forumApi.getCursor<Thread>("/api/v1/digest", {
			limit,
			cursor: params.cursor,
			forumId: params.forumId,
		}),
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
