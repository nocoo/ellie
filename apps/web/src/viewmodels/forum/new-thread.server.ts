/**
 * New-thread page server-only data loader.
 * Fetches forum context via the lightweight ancestors endpoint
 * for breadcrumbs (avoids full forum list fetch).
 */

import "server-only";

import { ForumApiError } from "@/lib/forum-api";
import { buildNewThreadBreadcrumbsFromAncestors } from "@/lib/forum-breadcrumbs";
import { getCachedForumAncestors } from "@/lib/forum-cache";
import type { BreadcrumbItem } from "@/viewmodels/shared/breadcrumbs";

export interface NewThreadPageData {
	forumId: number;
	forumName: string;
	breadcrumbs: BreadcrumbItem[];
}

/**
 * Load data required to render the new-thread page shell.
 * Uses the /ancestors endpoint — 0 D1 queries on KV cache hit.
 */
export async function loadNewThreadPageData(forumId: number): Promise<NewThreadPageData> {
	try {
		const { forum, ancestors } = await getCachedForumAncestors(forumId);
		return {
			forumId,
			forumName: forum.name,
			breadcrumbs: buildNewThreadBreadcrumbsFromAncestors(ancestors, forumId, forum.name),
		};
	} catch (error) {
		// Only gracefully degrade on 404/not-accessible — rethrow unexpected errors
		if (error instanceof ForumApiError && error.status === 404) {
			return {
				forumId,
				forumName: `版块 ${forumId}`,
				breadcrumbs: [
					{ label: "同济网论坛", href: "/", icon: "home" },
					{ label: `版块 ${forumId}` },
					{ label: "发表主题" },
				],
			};
		}
		throw error;
	}
}
