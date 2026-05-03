/**
 * Lightweight title loaders for generateMetadata.
 *
 * Uses React cache()-backed helpers from forum-data so that
 * generateMetadata and the page loader share the same fetch
 * within one RSC render pass (no duplicate Worker requests).
 */

import "server-only";

import { forumApi } from "@/lib/forum-api";
import { getForumList, getThreadById } from "@/lib/forum-data";
import type { PublicUser } from "@ellie/types";

/** Fetch thread subject by ID (deduped via getThreadById cache). */
export async function getThreadTitle(threadId: number): Promise<string> {
	const thread = await getThreadById(threadId);
	return thread.subject;
}

/** Fetch username by user ID. */
export async function getUserTitle(userId: number): Promise<string> {
	const { data: user } = await forumApi.get<PublicUser>(`/api/v1/users/${userId}`);
	return user.username;
}

/** Fetch forum name by ID (deduped via getForumList cache). */
export async function getForumTitle(forumId: number): Promise<string> {
	const forums = await getForumList();
	const forum = forums.find((f) => f.id === forumId);
	return forum?.name ?? `版块 ${forumId}`;
}
