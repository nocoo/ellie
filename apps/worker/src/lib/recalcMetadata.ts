// Metadata recalculation helpers for forums and threads.
// After deleting or moving content, use these to recompute denormalized counters
// (threads/posts counts, last_thread_id, last_post_at, last_poster).

import type { Env } from "./env";

/**
 * Recalculate forum metadata from its threads and posts.
 * Updates: last_thread_id, last_post_at, last_poster.
 * (Thread/post counts are handled separately by the caller.)
 */
export async function recalcForumMetadata(env: Env, forumId: number): Promise<void> {
	// Find the most recently active thread in this forum
	const lastThread = await env.DB.prepare(
		"SELECT id, subject, last_post_at, last_poster FROM threads WHERE forum_id = ? ORDER BY last_post_at DESC LIMIT 1",
	)
		.bind(forumId)
		.first<{ id: number; subject: string; last_post_at: number; last_poster: string }>();

	await env.DB.prepare(
		"UPDATE forums SET last_thread_id = ?, last_post_at = ?, last_poster = ?, last_thread_subject = ? WHERE id = ?",
	)
		.bind(
			lastThread?.id ?? 0,
			lastThread?.last_post_at ?? 0,
			lastThread?.last_poster ?? "",
			lastThread?.subject ?? "",
			forumId,
		)
		.run();
}

/**
 * Recalculate thread metadata from its posts.
 * Updates: last_post_at, last_poster.
 * Falls back to the thread's own created_at and author_name if no posts remain.
 */
export async function recalcThreadMetadata(env: Env, threadId: number): Promise<void> {
	// Find the most recent post in this thread
	const lastPost = await env.DB.prepare(
		"SELECT created_at, author_name FROM posts WHERE thread_id = ? ORDER BY position DESC LIMIT 1",
	)
		.bind(threadId)
		.first<{ created_at: number; author_name: string }>();

	if (lastPost) {
		await env.DB.prepare("UPDATE threads SET last_post_at = ?, last_poster = ? WHERE id = ?")
			.bind(lastPost.created_at, lastPost.author_name, threadId)
			.run();
	} else {
		// No posts remain — fall back to thread's own creation info
		const thread = await env.DB.prepare("SELECT created_at, author_name FROM threads WHERE id = ?")
			.bind(threadId)
			.first<{ created_at: number; author_name: string }>();
		if (thread) {
			await env.DB.prepare("UPDATE threads SET last_post_at = ?, last_poster = ? WHERE id = ?")
				.bind(thread.created_at, thread.author_name, threadId)
				.run();
		}
	}
}
