// viewmodels/forum/digest.ts — Digest list ViewModel
// Ref: 04d §精华列表 — cross-forum digest threads

import type { Repositories } from "@/data/index";
import type { PaginatedResult } from "@/data/repositories/types";
import type { Thread } from "@/models/types";
import { type ThreadListItem, enrichThread } from "./thread-list";

export interface DigestListData {
	items: ThreadListItem[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

/**
 * Fetch digest (featured) threads across all forums.
 */
export async function fetchDigestList(
	repos: Repositories,
	options: {
		cursor?: string;
		direction?: "forward" | "backward";
		limit?: number;
	} = {},
): Promise<DigestListData> {
	const result: PaginatedResult<Thread> = await repos.threads.list({
		digest: true,
		sort: "latest",
		cursor: options.cursor,
		direction: options.direction,
		limit: options.limit ?? 20,
	});

	return {
		items: result.items.map(enrichThread),
		nextCursor: result.nextCursor,
		prevCursor: result.prevCursor,
		total: result.total,
	};
}
