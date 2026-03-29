// viewmodels/forum/thread-detail.server.ts — Server-only data loader for thread detail
// Calls repositories directly (mock phase). Phase 2 replaces with Worker API.

import { type PaginatedResult, createRepositories } from "@ellie/repositories";
import type { Attachment, Post, Thread, User } from "@ellie/types";
import {
	type EnrichedPost,
	enrichPosts,
	groupAttachmentsByPostId,
	uniqueAuthorIds,
} from "./thread-detail";

export interface ThreadDetailData {
	thread: Thread;
	posts: EnrichedPost[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

export async function loadThreadDetail(params: {
	threadId: number;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<ThreadDetailData> {
	const repos = createRepositories();

	// Parallel fetch: thread + posts + all thread attachments
	const [thread, postResult, attachments] = await Promise.all([
		repos.threads.getById(params.threadId),
		repos.posts.list({
			threadId: params.threadId,
			cursor: params.cursor,
			direction: params.direction,
			limit: params.limit ?? 20,
		}) as Promise<PaginatedResult<Post>>,
		repos.attachments.listByThreadId(params.threadId) as Promise<Attachment[]>,
	]);

	if (!thread) {
		throw new Error("Thread not found");
	}

	// Batch author lookup
	const authorIds = uniqueAuthorIds(postResult.items);
	const authorMap = new Map<number, User>();
	for (const id of authorIds) {
		const user = await repos.users.getById(id);
		if (user) authorMap.set(user.id, user);
	}

	// Group attachments by postId
	const attachmentMap = groupAttachmentsByPostId(attachments);

	// Enrich posts
	const posts = enrichPosts(postResult.items, authorMap, attachmentMap, null, thread.forumId);

	return {
		thread,
		posts,
		nextCursor: postResult.nextCursor,
		prevCursor: postResult.prevCursor,
		total: postResult.total,
	};
}
