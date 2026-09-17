// User counter helpers — decrement thread/post counts after admin deletions.
// Uses MAX(0, ...) to prevent negative values from stale data.

import { confirmedBatch, confirmedRun } from "./d1-write";
import type { Env } from "./env";

/** A single bound statement, suitable for the same transaction as content deletion. */
export function buildUserCounterDecrementStatements(
	env: Env,
	counts: Map<number, number>,
	column: "posts" | "threads" | "digest_posts" = "posts",
	onlyIfNotPurged?: number,
): D1PreparedStatement[] {
	if (counts.size === 0) return [];
	const guard =
		onlyIfNotPurged === undefined
			? ""
			: " AND EXISTS (SELECT 1 FROM users AS target WHERE target.id = ? AND target.status != -99)";
	return [
		env.DB.prepare(
			`UPDATE users SET ${column} = MAX(0, ${column} - delta.value)
			 FROM json_each(?) AS delta WHERE users.id = CAST(delta.key AS INTEGER)${guard}`,
		).bind(
			JSON.stringify(Object.fromEntries(counts)),
			...(onlyIfNotPurged === undefined ? [] : [onlyIfNotPurged]),
		),
	];
}

/** Decrement a user's thread count by the specified amount. */
export async function decrementUserThreads(env: Env, userId: number, count = 1): Promise<void> {
	await confirmedRun(
		env.DB.prepare("UPDATE users SET threads = MAX(0, threads - ?) WHERE id = ?").bind(
			count,
			userId,
		),
	);
}

/** Decrement a user's post count by the specified amount. */
export async function decrementUserPosts(env: Env, userId: number, count = 1): Promise<void> {
	await confirmedRun(
		env.DB.prepare("UPDATE users SET posts = MAX(0, posts - ?) WHERE id = ?").bind(count, userId),
	);
}

/**
 * Batch decrement post counts for multiple users.
 * Accepts a Map of userId → count to decrement.
 * Uses one statement regardless of the number of affected authors.
 */
export async function batchDecrementUserPosts(
	env: Env,
	authorCounts: Map<number, number>,
): Promise<void> {
	if (authorCounts.size === 0) return;

	await confirmedBatch(env, buildUserCounterDecrementStatements(env, authorCounts));
}
