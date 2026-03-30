// viewmodels/forum/thread-list.server.ts — Server-only data loader for thread list
// Calls Worker API (GET /api/v1/forums + GET /api/v1/threads).

import { forumApi } from "@/lib/forum-api";
import {
	type Forum,
	type ForumTreeNode,
	type Thread,
	buildForumTree,
	filterVisibleForums,
} from "@ellie/types";
import { type ThreadDisplayItem, type ThreadSort, enrichThreads } from "./thread-list";

export interface ThreadListData {
	forum: ForumTreeNode | null;
	items: ThreadDisplayItem[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

export async function loadThreadList(params: {
	forumId: number;
	sort?: ThreadSort;
	digestOnly?: boolean;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<ThreadListData> {
	// Parallel fetch: forum tree + threads
	const [forumsRes, threadsRes] = await Promise.all([
		forumApi.getAll<Forum>("/api/v1/forums"),
		forumApi.getCursor<Thread>("/api/v1/threads", {
			forumId: params.forumId,
			limit: params.limit ?? 100,
			cursor: params.cursor,
		}),
	]);

	// Build forum tree and find current forum
	const tree = buildForumTree(forumsRes.data);
	const visible = tree.map(filterVisibleForums).filter((n): n is ForumTreeNode => n !== null);
	const forum = findNodeById(visible, params.forumId);

	return {
		forum,
		items: enrichThreads(threadsRes.data),
		nextCursor: threadsRes.meta.nextCursor,
		prevCursor: null, // Worker v1 does not support backward pagination
		total: forum?.threads ?? threadsRes.data.length,
	};
}

function findNodeById(nodes: ForumTreeNode[], id: number): ForumTreeNode | null {
	for (const node of nodes) {
		if (node.id === id) return node;
		const found = findNodeById(node.children, id);
		if (found) return found;
	}
	return null;
}
