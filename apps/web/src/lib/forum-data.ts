/**
 * Server-only forum data loaders (unwrapped).
 *
 * Phase B note: these are pure async loaders. RSC render-pass dedupe is
 * applied centrally in `lib/forum-cache.ts`, not here. Do not import
 * React `cache()` in this file — the static guard
 * (`tests/unit/architecture/no-adhoc-cache.test.ts`) forbids it.
 */

import "server-only";

import {
	type Forum,
	type ForumVisibility,
	isReadingBucket,
	type ModeratorInfo,
	type ReadingBucket,
	type Thread,
} from "@ellie/types";
import type { ForumThreadTypesPublic } from "@/viewmodels/forum/thread-types";
import { forumApi } from "./forum-api";

/** Fetch a single thread by ID. */
export async function fetchThreadById(threadId: number): Promise<Thread> {
	const { data } = await forumApi.get<Thread>(`/api/v1/threads/${threadId}`);
	return data;
}

export async function fetchThreadMetadata(threadId: number): Promise<Thread> {
	const { data } = await forumApi.get<Thread>(`/api/v1/threads/${threadId}`, undefined, {
		readPurpose: "metadata",
	});
	return data;
}

/** Fetch the full forum list. */
export async function fetchForumList(): Promise<Forum[]> {
	const { data } = await forumApi.getAll<Forum>("/api/v1/forums");
	return data;
}

export interface ForumStructure {
	/** Static metadata; every summary field is zeroed by the Worker. */
	forums: Forum[];
	/** Worker-authorized reading bucket for this response, when provided. */
	bucket: ReadingBucket | null;
}

/**
 * Static forum structure (`/api/v1/forums?view=structure`) — the doc/29
 * source for tree/breadcrumb/names. Skips the retired summary aggregates;
 * display numbers come from the reading contract instead. The caller's JWT
 * is forwarded so member/staff/admin forums resolve for signed-in viewers.
 */
export async function fetchForumStructure(jwt: string | null): Promise<ForumStructure> {
	const call = jwt
		? forumApi.getAuth<Forum[]>("/api/v1/forums", jwt, { view: "structure" })
		: forumApi.getAll<Forum>("/api/v1/forums", { view: "structure" });
	const { data, meta } = await call;
	const bucket = ((meta ?? {}) as { bucket?: unknown }).bucket;
	return {
		forums: data,
		bucket: typeof bucket === "string" && isReadingBucket(bucket) ? bucket : null,
	};
}

/** Name chips do not need counters, latest threads or their authors. */
export async function fetchForumNames(): Promise<Pick<Forum, "id" | "name">[]> {
	const { data } = await forumApi.getAll<Pick<Forum, "id" | "name">>("/api/v1/forums", {
		view: "names",
	});
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
