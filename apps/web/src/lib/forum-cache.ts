/**
 * Server-only React `cache()` boundary.
 *
 * Phase B (cache-layer abstraction): the ONLY file in `apps/web/src/`
 * allowed to `import { cache } from "react"`. All RSC-render-pass dedupe
 * for forum data goes through here.
 *
 * Inputs are the unwrapped loaders in `lib/forum-data.ts` and
 * `lib/forum-settings.ts`; this file wraps each with React `cache()` so
 * `generateMetadata` + the page component can call them independently
 * without double-fetching the Worker.
 *
 * Cross-request freshness is unaffected: `forum-api.ts` still passes
 * `cache: "no-store"`, so each new request re-loads from the Worker.
 *
 * Enforced by `tests/unit/architecture/no-adhoc-cache.test.ts`.
 */

import "server-only";

import { loadRecommendedThreads } from "@/viewmodels/forum/recommended-threads.server";
import { cache } from "react";
import {
	type ForumAncestorsData,
	fetchForumAncestors,
	fetchForumList,
	fetchForumThreadTypes,
	fetchThreadById,
} from "./forum-data";
import { type ForumSettings, fetchForumSettings } from "./forum-settings";
import { type SettingsMap, fetchPublicSettingsRaw } from "./public-settings";

// ---------------------------------------------------------------------------
// Forum data (deduplicated within the same RSC render pass)
// ---------------------------------------------------------------------------

export const getCachedThreadById = cache(fetchThreadById);
export const getCachedForumList = cache(fetchForumList);
export const getCachedForumAncestors = cache(fetchForumAncestors);
export const getCachedForumThreadTypes = cache(fetchForumThreadTypes);
export const getCachedRecommendedThreads = cache(loadRecommendedThreads);

// ---------------------------------------------------------------------------
// Forum settings
// ---------------------------------------------------------------------------

export const getCachedForumSettings = cache(fetchForumSettings);
export const getCachedPublicSettings = cache(fetchPublicSettingsRaw);

/** Convenience: page size from cached settings. */
export async function getCachedPageSize(): Promise<number> {
	const settings = await getCachedForumSettings();
	return settings.pageSize;
}

/** Convenience: posts-per-page from cached settings. */
export async function getCachedPostsPerPage(): Promise<number> {
	const settings = await getCachedForumSettings();
	return settings.postsPerPage;
}

// Re-export the data shape types so callers don't need to import the
// underlying loader modules.
export type { ForumAncestorsData, ForumSettings, SettingsMap };
export type { AncestorItem, ForumContext } from "./forum-data";
