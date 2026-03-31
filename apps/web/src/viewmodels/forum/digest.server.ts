// viewmodels/forum/digest.server.ts — Server-only data loader for digest page
// Worker v1 has no digest filter on thread list. Returns empty results for now.

import "server-only";

import type { Thread } from "@ellie/types";

/** Matches PaginatedResult shape from @ellie/repositories */
interface PaginatedResult<T> {
	items: T[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

export interface DigestData {
	results: PaginatedResult<Thread>;
}

export async function loadDigestList(_params: {
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<DigestData> {
	// Worker v1 has no digest filter — always return empty results.
	return {
		results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
	};
}
