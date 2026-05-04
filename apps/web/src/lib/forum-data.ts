/**
 * Cached data helpers for server-only React Server Component render passes.
 *
 * Uses React `cache()` to deduplicate identical fetches within the same RSC
 * render pass (e.g. generateMetadata + page component both needing the same
 * thread). Does NOT affect cross-request freshness — `cache: "no-store"` in
 * forum-api.ts still ensures every new page request hits the Worker.
 */

import "server-only";

import type { Forum, ForumVisibility, ModeratorInfo, Thread } from "@ellie/types";
import { cache } from "react";
import { forumApi } from "./forum-api";

/** Fetch a single thread by ID (deduplicated within same render pass). */
export const getThreadById = cache(async (threadId: number): Promise<Thread> => {
	const { data } = await forumApi.get<Thread>(`/api/v1/threads/${threadId}`);
	return data;
});

/** Fetch the full forum list (deduplicated within same render pass). */
export const getForumList = cache(async (): Promise<Forum[]> => {
	const { data } = await forumApi.getAll<Forum>("/api/v1/forums");
	return data;
});

// ─── Forum Context (ancestors endpoint) ─────────────────────────────

/** Forum structural context returned by the ancestors endpoint. */
export interface ForumContext {
	id: number;
	parentId: number;
	name: string;
	status: number;
	visibility: ForumVisibility;
	type: string;
	moderatorIds: string;
	moderatorList: ModeratorInfo[];
}

/** Ancestor breadcrumb item from the ancestors endpoint. */
export interface AncestorItem {
	id: number;
	parentId: number;
	name: string;
}

/** Full response from GET /api/v1/forums/:id/ancestors */
export interface ForumAncestorsData {
	forum: ForumContext;
	ancestors: AncestorItem[];
}

/**
 * Fetch forum context + ancestors for breadcrumbs (deduplicated within same render pass).
 * Uses the lightweight /ancestors endpoint instead of fetching the full forum list.
 */
export const getForumAncestors = cache(async (forumId: number): Promise<ForumAncestorsData> => {
	const { data } = await forumApi.get<ForumAncestorsData>(`/api/v1/forums/${forumId}/ancestors`);
	return data;
});
