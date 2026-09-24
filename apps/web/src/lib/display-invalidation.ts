import "server-only";

import { READING_BUCKETS } from "@ellie/types";
import { getMemoryRuntime } from "./memory-runtime";

export interface WriteInvalidation {
	forumId?: number;
	forumIds?: readonly number[];
	forumSummaries?: boolean;
	threadCounts?: boolean;
	siteStats?: boolean;
	homeDisplay?: boolean;
	forumLists?: boolean;
}

export function invalidateDisplayAfterWrite(changed: WriteInvalidation): void {
	const runtime = getMemoryRuntime();
	if (changed.forumSummaries) {
		if (changed.forumId != null) {
			for (const bucket of READING_BUCKETS) {
				runtime.clear("forum-summary", `bucket:${bucket}:forum:${changed.forumId}`);
			}
		} else {
			runtime.clear("forum-summary");
		}
	}
	if (changed.threadCounts) runtime.clear("thread-count");
	if (changed.siteStats) runtime.clear("site-stats");
	if (
		changed.homeDisplay === true ||
		changed.forumSummaries === true ||
		changed.threadCounts === true ||
		changed.siteStats === true
	)
		runtime.clear("home-display");
	if (
		changed.forumLists ||
		changed.homeDisplay ||
		changed.forumSummaries ||
		changed.threadCounts ||
		changed.siteStats
	) {
		const ids = changed.forumIds ?? (changed.forumId == null ? [] : [changed.forumId]);
		if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id < 1))
			runtime.clear("forum-list");
		else for (const id of new Set(ids)) runtime.clearPrefix("forum-list", `forum:${id}:`);
	}
}

export function mutationForumId(result: unknown): number | undefined {
	if (!result || typeof result !== "object" || !("data" in result)) return undefined;
	const data = result.data;
	if (!data || typeof data !== "object" || !("forumId" in data)) return undefined;
	return typeof data.forumId === "number" && Number.isSafeInteger(data.forumId) && data.forumId > 0
		? data.forumId
		: undefined;
}
