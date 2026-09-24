import "server-only";

import {
	buildForumTree,
	type Forum,
	type ForumListRecommended,
	type ForumTreeNode,
	findForumAncestors,
	type HomeUser,
} from "@ellie/types";
import { buildForumBreadcrumbs } from "@/lib/forum-breadcrumbs";
import { getCachedForumListContext } from "@/lib/forum-cache";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { fetchPublicSettings, getStr } from "./settings.server";
import { enrichThreads, lowerBoundPages, type ThreadDisplayItem } from "./thread-list";
import { type ForumThreadTypesPublic, shouldShowTypeNameBadge } from "./thread-types";

export interface ThreadListPagedData {
	forum: ForumTreeNode | null;
	forums: Forum[];
	items: ThreadDisplayItem[];
	page: number;
	pages: number;
	total: number;
	limit: number;
	hasNext: boolean;
	breadcrumbs: BreadcrumbItem[];
	user: HomeUser | null;
	typeId: number | null;
	threadTypes: ForumThreadTypesPublic | null;
	recommended: ForumListRecommended[];
}

export async function loadThreadListPaged(forumId: number): Promise<ThreadListPagedData> {
	const [context, settings] = await Promise.all([
		getCachedForumListContext(),
		fetchPublicSettings(),
	]);
	const { display, page, limit, total, hasNext } = context;
	if (context.forumId !== forumId) throw new Error("Forum context does not match route");
	const forums = display.forums;
	const forum = findNodeById(buildForumTree(forums), forumId);
	if (!forum) throw new Error("Forum missing from authorized context");
	return {
		forum,
		forums,
		items: enrichThreads(display.threads, {
			includeTypeNameBadge: shouldShowTypeNameBadge(display.threadTypes),
		}),
		page,
		limit,
		total,
		hasNext,
		pages: lowerBoundPages(page, limit, total, hasNext),
		breadcrumbs: buildForumBreadcrumbs(
			findForumAncestors(forums, forumId),
			getStr(settings, "general.site.home_label", "同济网论坛"),
		),
		user: context.user,
		typeId: context.typeId,
		threadTypes: display.threadTypes,
		recommended: display.recommended,
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
