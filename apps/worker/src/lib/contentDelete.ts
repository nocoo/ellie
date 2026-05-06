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
// Snapshot-id pattern: when used inside an `env.DB.batch()`, the caller MUST
// snapshot the parent ids BEFORE the batch (no sub-queries against tables
// that the same batch is mutating). D1 evaluates each statement against the
// committed view of the prior statement in the batch, so a SELECT-derived
// IN (...) embedded in a batch will see post-delete state.

import type { Env } from "./env";

function buildPlaceholders(n: number): string {
	return new Array(n).fill("?").join(",");
}

/**
 * Build child-row purge statements keyed on `post_id`. Use immediately before
 * any `DELETE FROM posts WHERE id IN (...)` statement to prevent FK violations
 * on `attachments.post_id` and `post_comments.post_id`.
 */
export function buildDeletePostChildStatements(env: Env, postIds: number[]): D1PreparedStatement[] {
	if (postIds.length === 0) return [];
	const ph = buildPlaceholders(postIds.length);
	return [
		env.DB.prepare(`DELETE FROM attachments WHERE post_id IN (${ph})`).bind(...postIds),
		env.DB.prepare(`DELETE FROM post_comments WHERE post_id IN (${ph})`).bind(...postIds),
	];
}

/**
 * Build child-row purge statements keyed on `thread_id`. Use immediately before
 * any `DELETE FROM posts WHERE thread_id IN (...)` / `DELETE FROM threads
 * WHERE id IN (...)` statement to prevent FK violations on
 * `attachments.thread_id` and `post_comments.thread_id`.
 *
 * Note: this only purges attachments/post_comments — the caller still owns
 * deleting the posts themselves (and the threads after that).
 */
export function buildDeleteThreadChildStatements(
	env: Env,
	threadIds: number[],
): D1PreparedStatement[] {
	if (threadIds.length === 0) return [];
	const ph = buildPlaceholders(threadIds.length);
	return [
		env.DB.prepare(`DELETE FROM attachments WHERE thread_id IN (${ph})`).bind(...threadIds),
		env.DB.prepare(`DELETE FROM post_comments WHERE thread_id IN (${ph})`).bind(...threadIds),
	];
}
