import "server-only";

import { ForumType } from "@ellie/types";
import { buildNewThreadBreadcrumbsFromAncestors } from "@/lib/forum-breadcrumbs";
import { getCachedForumAncestors } from "@/lib/forum-cache";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { fetchPublicSettings, getStr } from "./settings.server";

export interface NewThreadPageData {
	forumId: number;
	forumName: string;
	isGroup: boolean;
	breadcrumbs: BreadcrumbItem[];
}

export async function loadNewThreadPageData(forumId: number): Promise<NewThreadPageData> {
	const [settings, { forum, ancestors }] = await Promise.all([
		fetchPublicSettings(),
		getCachedForumAncestors(forumId),
	]);
	const homeLabel = getStr(settings, "general.site.home_label", "同济网论坛");
	return {
		forumId,
		forumName: forum.name,
		isGroup: forum.type === ForumType.Group,
		breadcrumbs: buildNewThreadBreadcrumbsFromAncestors(ancestors, forumId, forum.name, homeLabel),
	};
}
