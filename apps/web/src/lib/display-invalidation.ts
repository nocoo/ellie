import "server-only";

import { READING_BUCKETS } from "@ellie/types";
import { getMemoryRuntime, type MemoryRuntime } from "./memory-runtime";

export interface WriteInvalidation {
	forumId?: number;
	forumIds?: readonly number[];
	forumSummaries?: boolean;
	homeDisplay?: boolean;
	forumLists?: boolean;
	/** Thread-detail family invalidation. threadId targets one `thread:<id>`
	 * key; `all: true` clears the bounded ≤100-entry family. */
	threadDetail?: { threadId?: number; all?: boolean };
}

function clearForumScopes(
	runtime: MemoryRuntime,
	family: "forum-list",
	ids?: readonly number[],
): void {
	if (!ids?.length || ids.some((id) => !Number.isSafeInteger(id) || id < 1)) {
		runtime.clear(family);
		return;
	}
	for (const id of new Set(ids)) runtime.clearPrefix(family, `forum:${id}:`);
}

export function invalidateDisplayAfterWrite(changed: WriteInvalidation): void {
	const runtime = getMemoryRuntime();
	if (changed.forumSummaries) {
		if (changed.forumId != null) {
			for (const bucket of READING_BUCKETS) {
				runtime.clear("forum-summary", `bucket:${bucket}:forum:${changed.forumId}`);
			}
		} else runtime.clear("forum-summary");
	}
	const homeChanged = changed.homeDisplay || changed.forumSummaries;
	const listsChanged = homeChanged || changed.forumLists;
	if (homeChanged) runtime.clear("home-display");
	if (listsChanged) {
		clearForumScopes(
			runtime,
			"forum-list",
			changed.forumIds ?? (changed.forumId == null ? [] : [changed.forumId]),
		);
	}
	if (changed.threadDetail || listsChanged) {
		const tid = changed.threadDetail?.threadId;
		if (
			!changed.threadDetail?.all &&
			typeof tid === "number" &&
			Number.isSafeInteger(tid) &&
			tid > 0
		)
			runtime.clear("thread-detail", `thread:${tid}`);
		else runtime.clear("thread-detail");
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

// A post response's data.id is the post ID and must never select a thread cache.
export function mutationThreadId(result: unknown): number | undefined {
	if (!result || typeof result !== "object" || !("data" in result)) return undefined;
	const data = result.data;
	if (!data || typeof data !== "object") return undefined;
	const value = (data as Record<string, unknown>).threadId;
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Parse a route param id into a safe positive integer, or undefined. */
export function parseRouteId(id: string | number | undefined): number | undefined {
	if (typeof id === "number") return Number.isSafeInteger(id) && id > 0 ? id : undefined;
	if (typeof id !== "string" || !/^\d+$/.test(id)) return undefined;
	const n = Number(id);
	return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
