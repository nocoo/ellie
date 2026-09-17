// Metadata recalculation helpers for forums and threads.
// After deleting or moving content, use these to recompute denormalized counters
// (threads/posts counts, last_thread_id, last_post_at, last_poster, last_poster_id).
//
// SECURITY: These functions MUST only consider publicly visible content to avoid
// leaking metadata about hidden/pending posts or hidden threads.
// - Threads: sticky >= 0 (THREAD_VISIBLE)
// - Posts: invisible = 0 (POST_VISIBLE)

import { confirmedRun } from "./d1-write";
import type { Env } from "./env";
import { POST_VISIBLE, postVisible, THREAD_VISIBLE, threadVisible } from "./visibility";

/**
 * Repair counters and latest-content metadata inside the deletion transaction.
 * At most two statements / two bindings, even for thousands of affected rows.
 * Call after posts/threads are deleted, with the pre-deletion affected ID snapshot.
 */
export function buildContentRecalcStatements(
	env: Env,
	threadIds: number[],
	forumIds: number[],
): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [];
	if (threadIds.length) {
		statements.push(
			env.DB.prepare(`
			WITH latest AS (
				SELECT t.id AS thread_id,
				       COALESCE(p.created_at, t.created_at) AS posted_at,
				       COALESCE(p.author_name, t.author_name) AS poster,
				       COALESCE(p.author_id, t.author_id) AS poster_id,
				       COALESCE(p.anonymous, t.anonymous_author) AS anonymous
				FROM threads t LEFT JOIN posts p ON p.id = (
					SELECT id FROM posts WHERE thread_id = t.id AND ${POST_VISIBLE}
					ORDER BY position DESC LIMIT 1
				)
				WHERE t.id IN (SELECT value FROM json_each(?))
			)
			UPDATE threads SET
				replies = (SELECT COUNT(*) FROM posts WHERE thread_id = threads.id AND is_first = 0 AND ${POST_VISIBLE}),
				(last_post_at, last_poster, last_poster_id, anonymous_last_poster) =
				(SELECT posted_at, poster, poster_id, anonymous FROM latest WHERE thread_id = threads.id)
			WHERE id IN (SELECT thread_id FROM latest)
		`).bind(JSON.stringify(threadIds)),
		);
	}
	if (forumIds.length) {
		statements.push(
			env.DB.prepare(`
			WITH latest AS (
				SELECT f.id AS forum_id, t.id AS thread_id, t.last_post_at, t.last_poster, t.last_poster_id, t.subject
				FROM forums f LEFT JOIN threads t ON t.id = (
					SELECT id FROM threads WHERE forum_id = f.id AND ${THREAD_VISIBLE}
					ORDER BY last_post_at DESC LIMIT 1
				)
				WHERE f.id IN (SELECT value FROM json_each(?))
			)
			UPDATE forums SET
				threads = (SELECT COUNT(*) FROM threads WHERE forum_id = forums.id AND ${THREAD_VISIBLE}),
				posts = (SELECT COUNT(*) FROM posts p JOIN threads t ON p.thread_id = t.id
				         WHERE p.forum_id = forums.id AND ${postVisible("p")} AND ${threadVisible("t")}),
				(last_thread_id, last_post_at, last_poster, last_poster_id, last_thread_subject) =
				(SELECT COALESCE(thread_id, 0), COALESCE(last_post_at, 0), COALESCE(last_poster, ''),
				        COALESCE(last_poster_id, 0), COALESCE(subject, '') FROM latest WHERE forum_id = forums.id)
			WHERE id IN (SELECT forum_id FROM latest)
		`).bind(JSON.stringify(forumIds)),
		);
	}
	return statements;
}

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

	await confirmedRun(
		env.DB.prepare(
			"UPDATE forums SET last_thread_id = ?, last_post_at = ?, last_poster = ?, last_poster_id = ?, last_thread_subject = ? WHERE id = ?",
		).bind(
			lastThread?.id ?? 0,
			lastThread?.last_post_at ?? 0,
			lastThread?.last_poster ?? "",
			lastThread?.last_poster_id ?? 0,
			lastThread?.subject ?? "",
			forumId,
		),
	);
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
		await confirmedRun(
			env.DB.prepare(
				"UPDATE threads SET last_post_at = ?, last_poster = ?, last_poster_id = ?, anonymous_last_poster = ? WHERE id = ?",
			).bind(
				lastPost.created_at,
				lastPost.author_name,
				lastPost.author_id,
				lastPost.anonymous === 1 ? 1 : 0,
				threadId,
			),
		);
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
			await confirmedRun(
				env.DB.prepare(
					"UPDATE threads SET last_post_at = ?, last_poster = ?, last_poster_id = ?, anonymous_last_poster = ? WHERE id = ?",
				).bind(
					thread.created_at,
					thread.author_name,
					thread.author_id,
					thread.anonymous_author === 1 ? 1 : 0,
					threadId,
				),
			);
		}
	}
}
