// Helpers for tearing down rows that REFERENCE posts/threads via FK columns
// without ON DELETE CASCADE. Both `attachments` and `post_comments` carry
// `post_id` + `thread_id` FK columns into `posts` / `threads`. Without an
// explicit DELETE before the parent row goes away, D1 raises FOREIGN KEY
// constraint failed (500). These helpers build the prefix statements that
// every post/thread teardown path must include before its own
// `DELETE FROM posts` / `DELETE FROM threads`.
//
// Empty input is a no-op: returns `[]` so callers can spread unconditionally.
//
// Snapshot parent IDs before the batch. Child cleanup may look up the posts
// belonging to those threads while the parents still exist; it must run before
// deleting posts/threads. Later statements use the saved IDs, not a lookup of
// rows that have already been deleted.

import type { Env } from "./env";
import { buildContentRecalcStatements } from "./recalcMetadata";
import { buildUserCounterDecrementStatements } from "./userCounters";

interface DeletedPost {
	id: number;
	thread_id: number;
	forum_id: number;
	author_id: number;
}

/** Caller checks first-post permissions; all dependent writes share this batch. */
export function buildDeletePostStatements(env: Env, posts: DeletedPost[]): D1PreparedStatement[] {
	if (posts.length === 0) return [];
	const ids = posts.map((p) => p.id);
	const authors = new Map<number, number>();
	for (const post of posts) authors.set(post.author_id, (authors.get(post.author_id) ?? 0) + 1);
	return [
		...buildDeletePostChildStatements(env, ids),
		env.DB.prepare("DELETE FROM posts WHERE id IN (SELECT value FROM json_each(?))").bind(
			JSON.stringify(ids),
		),
		...buildContentRecalcStatements(
			env,
			[...new Set(posts.map((p) => p.thread_id))],
			[...new Set(posts.map((p) => p.forum_id))],
		),
		...buildUserCounterDecrementStatements(env, authors),
	];
}

/**
 * Build child-row purge statements keyed on `post_id`. Use immediately before
 * any `DELETE FROM posts WHERE id IN (...)` statement to prevent FK violations
 * on `attachments.post_id` and `post_comments.post_id`.
 */
export function buildDeletePostChildStatements(env: Env, postIds: number[]): D1PreparedStatement[] {
	if (postIds.length === 0) return [];
	const ids = JSON.stringify(postIds);
	return [
		env.DB.prepare(
			"DELETE FROM attachments WHERE post_id IN (SELECT value FROM json_each(?))",
		).bind(ids),
		env.DB.prepare(
			"DELETE FROM post_comments WHERE post_id IN (SELECT value FROM json_each(?))",
		).bind(ids),
	];
}

/**
 * Build child-row purge statements keyed on `thread_id`. Use immediately before
 * any `DELETE FROM posts WHERE thread_id IN (...)` / `DELETE FROM threads
 * WHERE id IN (...)` statement to prevent FK violations on
 * `attachments.thread_id` and `post_comments.thread_id`.
 *
 * Also purges `forum_recommended_threads` rows pointing at these threads.
 * That table has no FK declaration (migration 0045 keeps teardown explicit), but the public
 * GET list query joins onto `threads` so an orphan row would be silently
 * filtered. We still clean it up here so the (forum_id, thread_id) PK
 * slot is freed and a moderator can re-recommend a future thread that
 * happens to reuse the id without hitting an "INSERT OR IGNORE silently
 * succeeded but did nothing" state. Spec: migration 0045 + handler
 * `recommended.ts`.
 *
 * Note: this only purges attachments/post_comments/recommendations — the
 * caller still owns deleting the posts themselves (and the threads
 * after that).
 */
export function buildDeleteThreadChildStatements(
	env: Env,
	threadIds: number[],
): D1PreparedStatement[] {
	if (threadIds.length === 0) return [];
	const ids = JSON.stringify(threadIds);
	return [
		env.DB.prepare(
			"DELETE FROM attachments WHERE thread_id IN (SELECT value FROM json_each(?)) OR post_id IN (SELECT id FROM posts WHERE thread_id IN (SELECT value FROM json_each(?)))",
		).bind(ids, ids),
		env.DB.prepare(
			"DELETE FROM post_comments WHERE thread_id IN (SELECT value FROM json_each(?)) OR post_id IN (SELECT id FROM posts WHERE thread_id IN (SELECT value FROM json_each(?)))",
		).bind(ids, ids),
		env.DB.prepare(
			"DELETE FROM forum_recommended_threads WHERE thread_id IN (SELECT value FROM json_each(?))",
		).bind(ids),
	];
}
