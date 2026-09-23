// viewmodels/forum/thread-list.server.ts — Server-only data loader for thread list
// Doc/29: offset reads use includeTotal=false (page/limit/hasNext); the total
// comes from the authoritative reading-contract count cached per bucket, and
// the displayed page count is a lower bound that never clamps a real page.

import "server-only";

import {
	buildForumTree,
	type Forum,
	type ForumTreeNode,
	filterVisibleForums,
	findForumAncestors,
	type Thread,
} from "@ellie/types";
import { forumApi } from "@/lib/forum-api";
import { getWorkerJwt } from "@/lib/forum-auth";
import { buildForumBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { getCachedForumStructure, getCachedPageSize } from "@/lib/forum-cache";
import { loadThreadCount } from "@/lib/forum-reading";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { fetchPublicSettings, getStr } from "./settings.server";
import {
	enrichThreads,
	lowerBoundPages,
	type ThreadDisplayItem,
	type ThreadSort,
} from "./thread-list";

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
	/**
	 * Lower-bound page count (doc/29): at least the current page, one more
	 * while hasNext holds, and never below the cached authoritative total.
	 */
	pages: number;
	/** Authoritative count from the reading contract (cached per bucket). */
	total: number;
	limit: number;
	/** Whether the offset read saw a following page. */
	hasNext: boolean;
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
	const jwt = await getWorkerJwt();
	// Get page size from settings
	const defaultLimit = await getCachedPageSize();

	const [structure, threadsRes] = await Promise.all([
		getCachedForumStructure(jwt),
		jwt
			? forumApi.getCursorAuth<Thread>("/api/v1/threads", jwt, {
					forumId: params.forumId,
					limit: params.limit ?? defaultLimit,
					cursor: params.cursor,
				})
			: forumApi.getCursor<Thread>("/api/v1/threads", {
					forumId: params.forumId,
					limit: params.limit ?? defaultLimit,
					cursor: params.cursor,
				}),
	]);

	const forums = structure.forums;
	const total = await loadThreadCount(params.forumId, null, structure.bucket, jwt);
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
		total,
	};
}

export async function loadThreadListPaged(params: {
	forumId: number;
	page?: number;
	limit?: number;
	/**
	 * Optional 主题分类 filter. Caller is responsible for normalizing
	 * against the public thread-types payload (see
	 * `viewmodels/forum/thread-types.ts#normalizeTypeId`) so we don't
	 * round-trip stale / disabled / cross-forum ids to the Worker.
	 * `null` / `undefined` / `0` are all treated as "no filter" by the
	 * Worker; we omit the param entirely when not set.
	 */
	typeId?: number | null;
	/**
	 * Whether the prefix (typeName) badge should be surfaced on rows.
	 * Caller wires this from `shouldShowTypeNameBadge(threadTypes)` so
	 * forums with `thread_types_prefix=false` hide the badge regardless
	 * of denorm content. Defaults to `true` — callers that haven't
	 * wired thread-types config yet keep the historical behavior.
	 */
	includeTypeNameBadge?: boolean | Promise<boolean>;
}): Promise<ThreadListPagedData> {
	const page = params.page ?? 1;
	const jwt = await getWorkerJwt();
	// Get page size from settings
	const defaultLimit = await getCachedPageSize();
	const limit = params.limit ?? defaultLimit;

	const threadsQuery: Record<string, number | string | boolean> = {
		forumId: params.forumId,
		page,
		limit,
		includeTotal: false,
	};
	if (params.typeId != null && params.typeId > 0) {
		threadsQuery.typeId = params.typeId;
	}

	// Parallel start: forum structure, the offset page itself, settings and
	// badge config. Only the authoritative count waits for a successful list.
	const threadsCall = jwt
		? forumApi.getAuth<Thread[]>("/api/v1/threads", jwt, threadsQuery)
		: forumApi.get<Thread[]>("/api/v1/threads", threadsQuery);
	const [structure, threadsRes, settings, includeTypeNameBadge] = await Promise.all([
		getCachedForumStructure(jwt),
		threadsCall,
		fetchPublicSettings(),
		params.includeTypeNameBadge,
	]);
	const offsetMeta = threadsRes.meta as { page?: number; limit?: number; hasNext?: boolean };
	const resolvedPage = offsetMeta.page ?? page;
	const resolvedLimit = offsetMeta.limit ?? limit;
	const hasNext = offsetMeta.hasNext === true;

	// Authoritative count, cached per Worker-authorized bucket. The page
	// read above already succeeded, so this is a post-gate count hit.
	const total = await loadThreadCount(params.forumId, params.typeId ?? null, structure.bucket, jwt);
	const forums = structure.forums;

	// Build forum tree and find current forum
	const tree = buildForumTree(forums);
	const visible = tree
		.map((node) => filterVisibleForums(node))
		.filter((n): n is ForumTreeNode => n !== null);
	const forum = findNodeById(visible, params.forumId);

	// Build breadcrumbs from forum ancestors
	const ancestors = findForumAncestors(forums, params.forumId);
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	const breadcrumbs = buildForumBreadcrumbs(ancestors, homeLabel);

	return {
		forum,
		forums,
		items: enrichThreads(threadsRes.data, {
			includeTypeNameBadge,
		}),
		page: resolvedPage,
		pages: lowerBoundPages(resolvedPage, resolvedLimit, total, hasNext),
		total,
		limit: resolvedLimit,
		hasNext,
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
