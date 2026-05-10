// viewmodels/forum/thread-list.server.ts — Server-only data loader for thread list
// Calls Worker API (GET /api/v1/forums + GET /api/v1/threads).

import "server-only";

import { forumApi } from "@/lib/forum-api";
import { buildForumBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { getCachedForumList } from "@/lib/forum-cache";
import { getCachedPageSize } from "@/lib/forum-cache";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import {
	type Forum,
	type ForumTreeNode,
	type Thread,
	buildForumTree,
	filterVisibleForums,
	findForumAncestors,
} from "@ellie/types";
import { type ThreadDisplayItem, type ThreadSort, enrichThreads } from "./thread-list";

export interface ThreadListData {
	forum: ForumTreeNode | null;
	items: ThreadDisplayItem[];
	nextCursor: string | null;
	prevCursor: string | null;
	total: number;
}

export interface ThreadListPagedData {
	forum: ForumTreeNode | null;
	forums: Forum[];
	items: ThreadDisplayItem[];
	page: number;
	pages: number;
	total: number;
	limit: number;
	breadcrumbs: BreadcrumbItem[];
}

export async function loadThreadList(params: {
	forumId: number;
	sort?: ThreadSort;
	digestOnly?: boolean;
	cursor?: string;
	direction?: "forward" | "backward";
	limit?: number;
}): Promise<ThreadListData> {
	// Get page size from settings
	const defaultLimit = await getCachedPageSize();

	// Parallel fetch: forum tree + threads (forums deduped via React cache)
	const [forums, threadsRes] = await Promise.all([
		getCachedForumList(),
		forumApi.getCursor<Thread>("/api/v1/threads", {
			forumId: params.forumId,
			limit: params.limit ?? defaultLimit,
			cursor: params.cursor,
		}),
	]);

	// Build forum tree and find current forum
	const tree = buildForumTree(forums);
	const visible = tree
		.map((node) => filterVisibleForums(node))
		.filter((n): n is ForumTreeNode => n !== null);
	const forum = findNodeById(visible, params.forumId);

	return {
		forum,
		items: enrichThreads(threadsRes.data),
		nextCursor: threadsRes.meta.nextCursor,
		prevCursor: null, // Worker v1 does not support backward pagination
		total: forum?.threads ?? threadsRes.data.length,
	};
}

export async function loadThreadListPaged(params: {
	forumId: number;
	page?: number;
	limit?: number;
}): Promise<ThreadListPagedData> {
	const page = params.page ?? 1;
	// Get page size from settings
	const defaultLimit = await getCachedPageSize();
	const limit = params.limit ?? defaultLimit;

	// Parallel fetch: forum tree + threads (forums deduped via React cache)
	const [forums, threadsRes] = await Promise.all([
		getCachedForumList(),
		forumApi.getPage<Thread>("/api/v1/threads", {
			forumId: params.forumId,
			page,
			limit,
		}),
	]);

	// Build forum tree and find current forum
	const tree = buildForumTree(forums);
	const visible = tree
		.map((node) => filterVisibleForums(node))
		.filter((n): n is ForumTreeNode => n !== null);
	const forum = findNodeById(visible, params.forumId);

	// Build breadcrumbs from forum ancestors
	const ancestors = findForumAncestors(forums, params.forumId);
	const breadcrumbs = buildForumBreadcrumbs(ancestors);

	return {
		forum,
		forums,
		items: enrichThreads(threadsRes.data),
		page: threadsRes.meta.page ?? page,
		pages: threadsRes.meta.pages ?? 1,
		total: threadsRes.meta.total ?? 0,
		limit: threadsRes.meta.limit ?? limit,
		breadcrumbs,
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
