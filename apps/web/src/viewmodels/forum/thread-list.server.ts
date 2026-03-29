// viewmodels/forum/thread-list.server.ts — Server-only data loader for thread list
// Calls repositories directly (mock phase). Phase 2 replaces with Worker API.

import { type PaginatedResult, createRepositories } from "@ellie/repositories";
import { type ForumTreeNode, type Thread, buildForumTree, filterVisibleForums } from "@ellie/types";
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
	const repos = createRepositories();

	// Load forum info
	const allForums = await repos.forums.listAll();
	const tree = buildForumTree(allForums);
	const visible = tree.map(filterVisibleForums).filter((n): n is ForumTreeNode => n !== null);
	const forum = findNodeById(visible, params.forumId);

	// Load threads
	const result: PaginatedResult<Thread> = await repos.threads.list({
		forumId: params.forumId,
		sort: params.sort ?? "latest",
		digest: params.digestOnly || undefined,
		cursor: params.cursor,
		direction: params.direction,
		limit: params.limit ?? 20,
	});

	return {
		forum,
		items: enrichThreads(result.items),
		nextCursor: result.nextCursor,
		prevCursor: result.prevCursor,
		total: result.total,
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
