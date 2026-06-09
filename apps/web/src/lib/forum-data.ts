/**
 * Server-only forum data loaders (unwrapped).
 *
 * Phase B note: these are pure async loaders. RSC render-pass dedupe is
 * applied centrally in `lib/forum-cache.ts`, not here. Do not import
 * React `cache()` in this file — the static guard
 * (`tests/unit/architecture/no-adhoc-cache.test.ts`) forbids it.
 */

import "server-only";

import type { Forum, ForumVisibility, ModeratorInfo, Thread } from "@ellie/types";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { forumApi } from "./forum-api";

/** Fetch a single thread by ID. */
export async function fetchThreadById(threadId: number): Promise<Thread> {
	const { data } = await forumApi.get<Thread>(`/api/v1/threads/${threadId}`);
	return data;
}

/** Fetch the full forum list. */
export async function fetchForumList(): Promise<Forum[]> {
	const { data } = await forumApi.getAll<Forum>("/api/v1/forums");
	return data;
}

// ─── Forum Context (ancestors endpoint) ─────────────────────────────

/** Forum structural context returned by the ancestors endpoint. */
export interface ForumContext {
	id: number;
	parentId: number;
	name: string;
	status: number;
	visibility: ForumVisibility;
	type: string;
	moderators: string;
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
 * Fetch forum context + ancestors for breadcrumbs. Uses the lightweight
 * `/ancestors` endpoint instead of fetching the full forum list.
 */
export async function fetchForumAncestors(forumId: number): Promise<ForumAncestorsData> {
	const { data } = await forumApi.get<ForumAncestorsData>(`/api/v1/forums/${forumId}/ancestors`);
	return data;
}

// ─── Forum Thread Types (主题分类) ──────────────────────────────────

/**
 * Fetch the public 主题分类 payload for a forum.
 *
 * Returns `{enabled, required, listable, prefix, types}` — only enabled
 * rows. Most forums have all-zero config; callers MUST treat empty /
 * disabled payloads as "no UI" rather than rendering an empty filter
 * (see `viewmodels/forum/thread-types.ts` predicates).
 *
 * Wrapped by `getCachedForumThreadTypes` in `lib/forum-cache.ts`.
 */
export async function fetchForumThreadTypes(forumId: number): Promise<ForumThreadTypesPublic> {
	const { data } = await forumApi.get<ForumThreadTypesPublic>(
		`/api/v1/forums/${forumId}/thread-types`,
	);
	return data;
}
