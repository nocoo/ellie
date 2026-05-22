// viewmodels/forum/recommended-threads.server.ts — Server-only loader
// for the per-forum "推荐主题" card.
//
// Calls Worker `GET /api/v1/forums/:id/recommended-threads`. The worker
// applies forum visibility (same gate as the bare forum read path) and
// caps the response at 6 newest threads ordered by `thread_id DESC`.
// See `apps/worker/src/handlers/recommended.ts` + migration 0045.
//
// Fail-soft: the forum page MUST stay renderable when this endpoint
// 404/500s. Callers wrap in `.catch(() => null)`.

import "server-only";

import { forumApi } from "@/lib/forum-api";

export interface RecommendedThreadItem {
	id: number;
	subject: string;
	authorId: number;
	authorName: string;
	replies: number;
	lastPostAt: number;
	recommendedAt: number;
}

export interface RecommendedThreadsResponse {
	forumId: number;
	threads: RecommendedThreadItem[];
}

/**
 * Fetch the (≤6) recommended threads for a forum. The worker enforces
 * visibility — a 404 here is indistinguishable from "forum private" or
 * "forum missing" by design; the forum page already 404s in those cases
 * so the card never needs to.
 */
export async function loadRecommendedThreads(forumId: number): Promise<RecommendedThreadsResponse> {
	const { data } = await forumApi.get<RecommendedThreadsResponse>(
		`/api/v1/forums/${forumId}/recommended-threads`,
	);
	return data;
}
