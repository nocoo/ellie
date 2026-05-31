// Metadata recalculation helpers for forums and threads.
// After deleting or moving content, use these to recompute denormalized counters
// (threads/posts counts, last_thread_id, last_post_at, last_poster, last_poster_id).
//
// SECURITY: These functions MUST only consider publicly visible content to avoid
// leaking metadata about hidden/pending posts or hidden threads.
// - Threads: sticky >= 0 (THREAD_VISIBLE)
// - Posts: invisible = 0 (POST_VISIBLE)

import type { Env } from "./env";
import { POST_VISIBLE, THREAD_VISIBLE } from "./visibility";

/**
 * Recalculate forum metadata from its visible threads.
 * Updates: last_thread_id, last_post_at, last_poster, last_poster_id, last_thread_subject.
 * (Thread/post counts are handled separately by the caller.)
 *
 * SECURITY: Only considers visible threads (sticky >= 0) to prevent metadata leakage.
 */
export async function recalcForumMetadata(env: Env, forumId: number): Promise<void> {
	// Find the most recently active VISIBLE thread in this forum
	const lastThread = await env.DB.prepare(
		`SELECT id, subject, last_post_at, last_poster, last_poster_id
		 FROM threads
		 WHERE forum_id = ? AND ${THREAD_VISIBLE}
		 ORDER BY last_post_at DESC LIMIT 1`,
	)
		.bind(forumId)
		.first<{
			id: number;
			subject: string;
			last_post_at: number;
			last_poster: string;
			last_poster_id: number;
		}>();

	await env.DB.prepare(
		"UPDATE forums SET last_thread_id = ?, last_post_at = ?, last_poster = ?, last_poster_id = ?, last_thread_subject = ? WHERE id = ?",
	)
		.bind(
			lastThread?.id ?? 0,
			lastThread?.last_post_at ?? 0,
			lastThread?.last_poster ?? "",
			lastThread?.last_poster_id ?? 0,
			lastThread?.subject ?? "",
			forumId,
		)
		.run();
}

/**
 * Recalculate thread metadata from its visible posts.
 * Updates: last_post_at, last_poster, last_poster_id.
 * Falls back to the thread's own created_at and author_name/author_id if no visible posts remain.
 *
 * SECURITY: Only considers visible posts (invisible = 0) to prevent metadata leakage.
 */
export async function recalcThreadMetadata(env: Env, threadId: number): Promise<void> {
	// Find the most recent VISIBLE post in this thread
	const lastPost = await env.DB.prepare(
		`SELECT created_at, author_name, author_id, anonymous
		 FROM posts
		 WHERE thread_id = ? AND ${POST_VISIBLE}
		 ORDER BY position DESC LIMIT 1`,
	)
		.bind(threadId)
		.first<{
			created_at: number;
			author_name: string;
			author_id: number;
			anonymous: number;
		}>();

	if (lastPost) {
		await env.DB.prepare(
			"UPDATE threads SET last_post_at = ?, last_poster = ?, last_poster_id = ?, anonymous_last_poster = ? WHERE id = ?",
		)
			.bind(
				lastPost.created_at,
				lastPost.author_name,
				lastPost.author_id,
				lastPost.anonymous === 1 ? 1 : 0,
				threadId,
			)
			.run();
	} else {
		// No visible posts remain — fall back to thread's own creation info.
		// `anonymous_author` already reflects the original first-post flag, so
		// reuse it for the last-poster denorm too.
		const thread = await env.DB.prepare(
			"SELECT created_at, author_name, author_id, anonymous_author FROM threads WHERE id = ?",
		)
			.bind(threadId)
			.first<{
				created_at: number;
				author_name: string;
				author_id: number;
				anonymous_author: number;
			}>();
		if (thread) {
			await env.DB.prepare(
				"UPDATE threads SET last_post_at = ?, last_poster = ?, last_poster_id = ?, anonymous_last_poster = ? WHERE id = ?",
			)
				.bind(
					thread.created_at,
					thread.author_name,
					thread.author_id,
					thread.anonymous_author === 1 ? 1 : 0,
					threadId,
				)
				.run();
		}
	}
}
