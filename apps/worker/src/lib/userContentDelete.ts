import { buildDeletePostChildStatements, buildDeleteThreadChildStatements } from "./contentDelete";
import { confirmedBatch } from "./d1-write";
import type { Env } from "./env";
import { buildContentRecalcStatements } from "./recalcMetadata";
import { buildUserCounterDecrementStatements } from "./userCounters";
import { STICKY_GLOBAL } from "./visibility";

/** Related ownership reads must see the same committed threads and first posts. */
export async function readUserContentSnapshot(env: Env, userId: number) {
	const [threadResult, postResult] = await confirmedBatch(env, [
		env.DB.prepare("SELECT id, forum_id, digest, sticky FROM threads WHERE author_id = ?").bind(
			userId,
		),
		env.DB.prepare(
			"SELECT p.id, p.thread_id, p.forum_id, p.author_id, t.digest AS thread_digest, t.sticky AS thread_sticky FROM posts p LEFT JOIN threads t ON t.id = p.thread_id WHERE p.author_id = ? OR p.thread_id IN (SELECT id FROM threads WHERE author_id = ?)",
		).bind(userId, userId),
	]);
	return {
		threads: threadResult.results as {
			id: number;
			forum_id: number;
			digest: number;
			sticky: number;
		}[],
		posts: postResult.results as {
			id: number;
			thread_id: number;
			forum_id: number;
			author_id: number;
			thread_digest: number | null;
			thread_sticky: number | null;
		}[],
	};
}

/** Shared by admin ban/nuke and forum moderation. All D1 writes commit together. */
export async function deleteUserContent(
	env: Env,
	userId: number,
	options: { resetCredits?: boolean; deleteOwnAttachments?: boolean } = {},
) {
	const [{ threads, posts }, attachmentCount] = await Promise.all([
		readUserContentSnapshot(env, userId),
		options.deleteOwnAttachments
			? env.DB.prepare(
					"SELECT COUNT(*) as cnt, json_group_array(DISTINCT post_id) as post_ids FROM attachments WHERE author_id = ?",
				)
					.bind(userId)
					.first<{ cnt: number; post_ids: string }>()
			: Promise.resolve(null),
	]);
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
	await confirmedBatch(env, statements);

	return {
		threadsDeleted: threadIds.length,
		postsDeleted: postIds.length,
		attachmentsDeleted: attachmentCount?.cnt ?? 0,
		attachmentPostIds: (JSON.parse(attachmentCount?.post_ids ?? "[]") as unknown[]).filter(
			(id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0,
		),
		affectedThreadIds: [...new Set([...threadIds, ...survivorThreadIds])],
		affectedForumIds,
		collateralAuthorIds: [...collateralAuthors.keys()],
		hadDigestThread:
			threads.some((t) => t.digest > 0) || posts.some((p) => (p.thread_digest ?? 0) > 0),
		hadGlobalThread:
			threads.some((t) => t.sticky === STICKY_GLOBAL) ||
			posts.some((p) => p.thread_sticky === STICKY_GLOBAL),
	};
}
