import { buildDeletePostChildStatements, buildDeleteThreadChildStatements } from "./contentDelete";
import type { Env } from "./env";
import { buildContentRecalcStatements } from "./recalcMetadata";
import { buildUserCounterDecrementStatements } from "./userCounters";

/** Shared by admin ban/nuke and forum moderation. All D1 writes commit together. */
export async function deleteUserContent(
	env: Env,
	userId: number,
	options: { resetCredits?: boolean; deleteOwnAttachments?: boolean } = {},
) {
	const [threadResult, postResult, attachmentCount] = await Promise.all([
		env.DB.prepare("SELECT id, forum_id, digest FROM threads WHERE author_id = ?")
			.bind(userId)
			.all<{ id: number; forum_id: number; digest: number }>(),
		env.DB.prepare(
			"SELECT id, thread_id, forum_id, author_id FROM posts WHERE author_id = ? OR thread_id IN (SELECT id FROM threads WHERE author_id = ?)",
		)
			.bind(userId, userId)
			.all<{ id: number; thread_id: number; forum_id: number; author_id: number }>(),
		options.deleteOwnAttachments
			? env.DB.prepare("SELECT COUNT(*) as cnt FROM attachments WHERE author_id = ?")
					.bind(userId)
					.first<{ cnt: number }>()
			: Promise.resolve(null),
	]);
	const threads = threadResult.results;
	const posts = postResult.results;
	const threadIds = threads.map((t) => t.id);
	const ownedThreads = new Set(threadIds);
	const postIds = posts.map((p) => p.id);
	const survivorThreadIds = [...new Set(posts.map((p) => p.thread_id))].filter(
		(id) => !ownedThreads.has(id),
	);
	const affectedForumIds = [
		...new Set([...threads.map((t) => t.forum_id), ...posts.map((p) => p.forum_id)]),
	];
	const collateralAuthors = new Map<number, number>();
	for (const post of posts) {
		if (post.author_id !== userId) {
			collateralAuthors.set(post.author_id, (collateralAuthors.get(post.author_id) ?? 0) + 1);
		}
	}

	const statements = [
		...buildDeleteThreadChildStatements(env, threadIds),
		...buildDeletePostChildStatements(env, postIds),
	];
	if (options.deleteOwnAttachments) {
		statements.push(env.DB.prepare("DELETE FROM attachments WHERE author_id = ?").bind(userId));
	}
	if (postIds.length) {
		statements.push(
			env.DB.prepare("DELETE FROM posts WHERE id IN (SELECT value FROM json_each(?))").bind(
				JSON.stringify(postIds),
			),
		);
	}
	if (threadIds.length) {
		statements.push(
			env.DB.prepare("DELETE FROM threads WHERE id IN (SELECT value FROM json_each(?))").bind(
				JSON.stringify(threadIds),
			),
		);
	}
	statements.push(
		...buildContentRecalcStatements(env, survivorThreadIds, affectedForumIds),
		...buildUserCounterDecrementStatements(env, collateralAuthors),
		env.DB.prepare(
			options.resetCredits
				? "UPDATE users SET status = -1, threads = 0, posts = 0, digest_posts = 0, credits = 0, coins = 0 WHERE id = ?"
				: "UPDATE users SET status = -1, threads = 0, posts = 0, digest_posts = 0 WHERE id = ?",
		).bind(userId),
	);
	await env.DB.batch(statements);

	return {
		threadsDeleted: threadIds.length,
		postsDeleted: postIds.length,
		attachmentsDeleted: attachmentCount?.cnt ?? 0,
		affectedForumIds,
		collateralAuthorIds: [...collateralAuthors.keys()],
		hadDigestThread: threads.some((t) => t.digest > 0),
	};
}
