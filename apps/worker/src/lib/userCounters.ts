// User counter helpers — decrement thread/post counts after admin deletions.
// Uses MAX(0, ...) to prevent negative values from stale data.

import type { Env } from "./env";

/** Decrement a user's thread count by the specified amount. */
export async function decrementUserThreads(env: Env, userId: number, count = 1): Promise<void> {
	await env.DB.prepare("UPDATE users SET threads = MAX(0, threads - ?) WHERE id = ?")
		.bind(count, userId)
		.run();
}

/** Decrement a user's post count by the specified amount. */
export async function decrementUserPosts(env: Env, userId: number, count = 1): Promise<void> {
	await env.DB.prepare("UPDATE users SET posts = MAX(0, posts - ?) WHERE id = ?")
		.bind(count, userId)
		.run();
}

/**
 * Batch decrement post counts for multiple users.
 * Accepts a Map of userId → count to decrement.
 */
export async function batchDecrementUserPosts(
	env: Env,
	authorCounts: Map<number, number>,
): Promise<void> {
	if (authorCounts.size === 0) return;

	const statements = Array.from(authorCounts.entries()).map(([userId, count]) =>
		env.DB.prepare("UPDATE users SET posts = MAX(0, posts - ?) WHERE id = ?").bind(count, userId),
	);

	await env.DB.batch(statements);
}

/**
 * Batch decrement thread counts for multiple users.
 * Accepts a Map of userId → count to decrement.
 */
export async function batchDecrementUserThreads(
	env: Env,
	authorCounts: Map<number, number>,
): Promise<void> {
	if (authorCounts.size === 0) return;

	const statements = Array.from(authorCounts.entries()).map(([userId, count]) =>
		env.DB.prepare("UPDATE users SET threads = MAX(0, threads - ?) WHERE id = ?").bind(
			count,
			userId,
		),
	);

	await env.DB.batch(statements);
}
