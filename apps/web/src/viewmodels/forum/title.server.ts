/**
 * Lightweight title loaders for generateMetadata.
 *
 * Only fetches the single resource needed for the page <title>,
 * avoiding the heavy page-level loaders that pull posts, attachments,
 * authors, pagination, breadcrumbs, etc.
 */

import "server-only";

import { forumApi } from "@/lib/forum-api";
import type { Forum, PublicUser, Thread } from "@ellie/types";

/** Fetch thread subject by ID. */
export async function getThreadTitle(threadId: number): Promise<string> {
	const { data: thread } = await forumApi.get<Thread>(`/api/v1/threads/${threadId}`);
	return thread.subject;
}

/** Fetch username by user ID. */
export async function getUserTitle(userId: number): Promise<string> {
	const { data: user } = await forumApi.get<PublicUser>(`/api/v1/users/${userId}`);
	return user.username;
}

/** Fetch forum name by ID (requires full forum list — no single-forum endpoint). */
export async function getForumTitle(forumId: number): Promise<string> {
	const { data: forums } = await forumApi.getAll<Forum>("/api/v1/forums");
	const forum = forums.find((f) => f.id === forumId);
	return forum?.name ?? `版块 ${forumId}`;
}
