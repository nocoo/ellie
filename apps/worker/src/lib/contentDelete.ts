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
 * Also purges `forum_recommended_threads` rows pointing at these threads.
 * That table is not FK-enforced (D1 FK is off, and we declined ON DELETE
 * CASCADE in migration 0045 to keep teardown explicit), but the public
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
	const ph = buildPlaceholders(threadIds.length);
	return [
		env.DB.prepare(`DELETE FROM attachments WHERE thread_id IN (${ph})`).bind(...threadIds),
		env.DB.prepare(`DELETE FROM post_comments WHERE thread_id IN (${ph})`).bind(...threadIds),
		env.DB.prepare(`DELETE FROM forum_recommended_threads WHERE thread_id IN (${ph})`).bind(
			...threadIds,
		),
	];
}

// ---------------------------------------------------------------------------
// Chunked batch execution
// ---------------------------------------------------------------------------

/** Maximum statements per D1 batch call. Keeps well under D1 limits. */
const D1_BATCH_CHUNK_SIZE = 80;

/**
 * Execute an array of D1 prepared statements in chunks, avoiding the D1
 * batch size limit. Each chunk runs as an independent batch; callers must
 * ensure cross-chunk ordering is acceptable.
 */
export async function batchChunked(
	db: D1Database,
	statements: D1PreparedStatement[],
): Promise<void> {
	if (statements.length === 0) return;
	for (let i = 0; i < statements.length; i += D1_BATCH_CHUNK_SIZE) {
		await db.batch(statements.slice(i, i + D1_BATCH_CHUNK_SIZE));
	}
}
