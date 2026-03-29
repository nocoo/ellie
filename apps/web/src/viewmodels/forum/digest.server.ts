// viewmodels/forum/digest.server.ts — Server-only data loader for digest page
// Ref: 04d §Digest — fetches digest threads via ThreadRepository

import { type PaginatedResult, createRepositories } from "@ellie/repositories";
import type { Thread } from "@ellie/types";

export interface DigestData {
	results: PaginatedResult<Thread>;
}

export async function loadDigestList(params: {
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<DigestData> {
	const repos = createRepositories();
	const results = (await repos.threads.list({
		digest: true,
		sort: "latest",
		cursor: params.cursor,
		direction: params.direction ?? "forward",
		limit: params.limit ?? 20,
	})) as PaginatedResult<Thread>;

	return { results };
}
