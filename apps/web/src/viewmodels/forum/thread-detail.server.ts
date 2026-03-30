// viewmodels/forum/thread-detail.server.ts — Server-only data loader for thread detail
// Calls Worker API (GET /api/v1/threads/:id + GET /api/v1/posts + GET /api/v1/posts/:id/attachments + GET /api/v1/users/:id).

import { forumApi, publicUserToUser } from "@/lib/forum-api";
import type { Attachment, Forum, Post, PublicUser, Thread, User } from "@ellie/types";
import {
	type EnrichedPost,
	enrichPosts,
	groupAttachmentsByPostId,
	uniqueAuthorIds,
} from "./thread-detail";

export interface ThreadDetailData {
	thread: Thread;
	forums: Forum[];
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
	// Parallel fetch: thread + posts + forums
	const [threadRes, postsRes, forumsRes] = await Promise.all([
		forumApi.get<Thread>(`/api/v1/threads/${params.threadId}`),
		forumApi.getCursor<Post>("/api/v1/posts", {
			threadId: params.threadId,
			limit: params.limit ?? 20,
			cursor: params.cursor,
		}),
		forumApi.getAll<Forum>("/api/v1/forums"),
	]);

	const thread = threadRes.data;

	// Fetch attachments per post (Worker only supports per-post, not per-thread)
	const attachmentResults = await Promise.all(
		postsRes.data.map((post) =>
			forumApi
				.getAll<Attachment>(`/api/v1/posts/${post.id}/attachments`)
				.then((res) => res.data)
				.catch(() => [] as Attachment[]),
		),
	);
	const allAttachments = attachmentResults.flat();

	// Batch author lookup (deduplicated)
	const authorIds = uniqueAuthorIds(postsRes.data);
	const authorEntries = await Promise.all(
		authorIds.map((id) =>
			forumApi
				.get<PublicUser>(`/api/v1/users/${id}`)
				.then((res) => [id, publicUserToUser(res.data)] as const)
				.catch(() => null),
		),
	);
	const authorMap = new Map<number, User>();
	for (const entry of authorEntries) {
		if (entry) authorMap.set(entry[0], entry[1]);
	}

	// Group attachments by postId and enrich posts
	const attachmentMap = groupAttachmentsByPostId(allAttachments);
	const posts = enrichPosts(postsRes.data, authorMap, attachmentMap, null, thread.forumId);

	return {
		thread,
		forums: forumsRes.data,
		posts,
		nextCursor: postsRes.meta.nextCursor,
		prevCursor: null, // Worker v1 does not support backward pagination
		total: postsRes.data.length,
	};
}
