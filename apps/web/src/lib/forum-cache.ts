/**
 * Server-only React `cache()` boundary.
 *
 * Phase B (cache-layer abstraction): the ONLY file in `apps/web/src/`
 * allowed to `import { cache } from "react"`. All RSC-render-pass dedupe
 * for forum data goes through here.
 *
 * Inputs are the unwrapped loaders in `lib/forum-data.ts` and
 * `lib/forum-settings.ts`; this file wraps each with React `cache()` so
 * repeated calls with the same arguments and read purpose share a request.
 * Thread metadata, layout and page share the authorized context. Only the page records a view.
 *
 * Public settings also share a five-minute cross-request snapshot.
 * Forum summaries remain request-scoped so Worker invalidation of deleted,
 * restricted or anonymized content is visible on the next render.
 *
 * Enforced by `tests/unit/architecture/no-adhoc-cache.test.ts`.
 */

import "server-only";

import { headers } from "next/headers";
import { cache } from "react";
import { resolveThreadPostCursor } from "@/viewmodels/forum/thread-list";
import {
	type ForumAncestorsData,
	fetchForumAncestors,
	fetchForumNames,
	fetchForumStructure,
	fetchForumThreadTypes,
} from "./forum-data";
import { FORUM_LIST_LOCATION_HEADER, parseForumListLocation } from "./forum-list-location";
import { loadForumListContext } from "./forum-list-reading";
import { type ForumSettings, parseForumSettings } from "./forum-settings";
import { loadHomeContext } from "./home-reading";
import { getMemoryRuntime } from "./memory-runtime";
import { getPublicSettings, type SettingsMap } from "./public-settings";
import { parseThreadLocation, THREAD_LOCATION_HEADER } from "./thread-location";
import { loadThreadContext } from "./thread-reading";

export const getCachedHomeContext = cache(loadHomeContext);
export const getCachedForumListContext = cache(async () => {
	const location = parseForumListLocation((await headers()).get(FORUM_LIST_LOCATION_HEADER));
	if (!location) throw new Error("Invalid forum list location");
	const settings = await getCachedForumSettings();
	const limit =
		Number.isSafeInteger(settings.pageSize) && settings.pageSize > 0
			? Math.min(settings.pageSize, 100)
			: 20;
	return loadForumListContext({ ...location, limit });
});

export const getCachedThreadContext = cache(async () => {
	const location = parseThreadLocation((await headers()).get(THREAD_LOCATION_HEADER));
	if (!location) throw new Error("Invalid thread location");
	const limit = await getCachedPostsPerPage();
	const { cursor, isLastPage } = resolveThreadPostCursor(location, limit);
	return loadThreadContext({
		threadId: location.threadId,
		limit,
		cursor: cursor ?? null,
		last: isLastPage,
	});
});

// ---------------------------------------------------------------------------
// Forum data (deduplicated within the same RSC render pass)
// ---------------------------------------------------------------------------

export const getCachedForumStructure = cache(fetchForumStructure);
export const getCachedForumNames = cache(fetchForumNames);
export const getCachedForumAncestors = cache(fetchForumAncestors);
export const getCachedForumThreadTypes = cache(fetchForumThreadTypes);

// ---------------------------------------------------------------------------
// Forum settings
// ---------------------------------------------------------------------------

export const getCachedPublicSettings = cache(getPublicSettings);
export const getCachedForumSettings = cache(async () => {
	try {
		return parseForumSettings(await getCachedPublicSettings());
	} catch {
		// A failed fetch is never cached; defaults apply only to this render.
		return parseForumSettings({});
	}
});

/** Convenience: page size from cached settings. */
export async function getCachedPageSize(): Promise<number> {
	const settings = await getCachedForumSettings();
	return settings.pageSize;
}

/** Convenience: posts-per-page from cached settings. */
export async function getCachedPostsPerPage(): Promise<number> {
	const settings = await getCachedForumSettings();
	return Number.isSafeInteger(settings.postsPerPage) && settings.postsPerPage > 0
		? Math.min(settings.postsPerPage, 100)
		: 20;
}

/**
 * Request-scoped view recording (doc/29): `cache()` memoizes per request per
 * thread id, so a successful page render counts exactly once even when the
 * loader runs in several render passes. The runtime buffers the increment.
 */
export const recordThreadView = cache((threadId: number) => {
	getMemoryRuntime().recordView(threadId);
});

export type { AncestorItem, ForumContext } from "./forum-data";
// Re-export the data shape types so callers don't need to import the
// underlying loader modules.
export type { ForumAncestorsData, ForumSettings, SettingsMap };
