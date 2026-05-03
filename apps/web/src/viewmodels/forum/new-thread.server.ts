/**
 * New-thread page server-only data loader.
 * Fetches the forum tree to build breadcrumbs for the new-thread page.
 */

import "server-only";

import { getForumList } from "@/lib/forum-data";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";
import { buildNewThreadBreadcrumbs } from "./new-thread";

export interface NewThreadPageData {
	forumId: number;
	forumName: string;
	breadcrumbs: BreadcrumbItem[];
}

/**
 * Load data required to render the new-thread page shell.
 * Only fetches forum ancestors for breadcrumbs — no thread data needed.
 */
export async function loadNewThreadPageData(forumId: number): Promise<NewThreadPageData> {
	const forums = await getForumList();
	const { findForumAncestors } = await import("@ellie/types");
	const ancestors = findForumAncestors(forums, forumId);

	const currentForum = forums.find((f) => f.id === forumId);
	const forumName = currentForum?.name ?? `版块 ${forumId}`;

	return {
		forumId,
		forumName,
		breadcrumbs: buildNewThreadBreadcrumbs(ancestors),
	};
}
