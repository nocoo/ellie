/**
 * Lightweight title loaders for generateMetadata.
 *
 * Uses the React cache()-backed helpers exported from
 * `lib/forum-cache` so that generateMetadata and the page loader
 * share the same fetch within one RSC render pass (no duplicate
 * Worker requests).
 */

import "server-only";

import { forumApi } from "@/lib/forum-api";
import { getCachedForumList, getCachedThreadById } from "@/lib/forum-cache";
import type { PublicUser } from "@ellie/types";

/** Fetch thread subject by ID (deduped via getThreadById cache). */
export async function getThreadTitle(threadId: number): Promise<string> {
	const thread = await getCachedThreadById(threadId);
	return thread.subject;
}

/** Fetch username by user ID. */
export async function getUserTitle(userId: number): Promise<string> {
	const { data: user } = await forumApi.get<PublicUser>(`/api/v1/users/${userId}`);
	return user.username;
}

/** Fetch forum name by ID (deduped via getForumList cache). */
export async function getForumTitle(forumId: number): Promise<string> {
	const forums = await getCachedForumList();
	const forum = forums.find((f) => f.id === forumId);
	return forum?.name ?? `版块 ${forumId}`;
}
