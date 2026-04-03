// Permission helper functions for moderation handlers
// Fetches user and forum data for permission checks using @ellie/types

import type { Forum, User } from "@ellie/types";
import type { Env } from "./env";

// Columns needed for permission checks
const USER_PERMISSION_COLUMNS = "id, username, role, status";
const FORUM_PERMISSION_COLUMNS = "id, moderators, moderator_ids";

/**
 * Fetch user data needed for permission checks
 */
export async function getUserForPermission(
	env: Env,
	userId: number,
): Promise<Pick<User, "id" | "username" | "role" | "status"> | null> {
	const row = await env.DB.prepare(`SELECT ${USER_PERMISSION_COLUMNS} FROM users WHERE id = ?`)
		.bind(userId)
		.first<{ id: number; username: string; role: number; status: number }>();

	if (!row) return null;

	return {
		id: row.id,
		username: row.username,
		role: row.role,
		status: row.status,
	};
}

/**
 * Fetch forum data needed for permission checks (moderators field)
 */
export async function getForumForPermission(
	env: Env,
	forumId: number,
): Promise<Pick<Forum, "id" | "moderators"> | null> {
	const row = await env.DB.prepare(`SELECT ${FORUM_PERMISSION_COLUMNS} FROM forums WHERE id = ?`)
		.bind(forumId)
		.first<{ id: number; moderators: string; moderator_ids: string }>();

	if (!row) return null;

	return {
		id: row.id,
		moderators: row.moderators,
	};
}

/**
 * Fetch thread with forum_id and author_id for permission checks
 */
export async function getThreadForPermission(
	env: Env,
	threadId: number,
): Promise<{ id: number; forumId: number; authorId: number } | null> {
	const row = await env.DB.prepare("SELECT id, forum_id, author_id FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ id: number; forum_id: number; author_id: number }>();

	if (!row) return null;

	return {
		id: row.id,
		forumId: row.forum_id,
		authorId: row.author_id,
	};
}

/**
 * Fetch post with author_id and forum_id for permission checks
 */
export async function getPostForPermission(
	env: Env,
	postId: number,
): Promise<{
	id: number;
	authorId: number;
	forumId: number;
	threadId: number;
	isFirst: boolean;
} | null> {
	const row = await env.DB.prepare(
		"SELECT id, author_id, forum_id, thread_id, is_first FROM posts WHERE id = ?",
	)
		.bind(postId)
		.first<{
			id: number;
			author_id: number;
			forum_id: number;
			thread_id: number;
			is_first: number;
		}>();

	if (!row) return null;

	return {
		id: row.id,
		authorId: row.author_id,
		forumId: row.forum_id,
		threadId: row.thread_id,
		isFirst: row.is_first === 1,
	};
}
