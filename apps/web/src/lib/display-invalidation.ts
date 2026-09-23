import "server-only";

import { READING_BUCKETS } from "@ellie/types";
import { getMemoryRuntime } from "./memory-runtime";

export interface WriteInvalidation {
	forumId?: number;
	forumSummaries?: boolean;
	threadCounts?: boolean;
	siteStats?: boolean;
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
}
