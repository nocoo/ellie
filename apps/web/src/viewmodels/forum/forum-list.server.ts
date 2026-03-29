// viewmodels/forum/forum-list.server.ts — Server-only data loader for forum list
// Calls Worker API (GET /api/v1/forums).

import { forumApi } from "@/lib/forum-api";
import type { Forum, ForumTreeNode } from "@ellie/types";
import { buildVisibleTree } from "./forum-list";

export async function loadForumList(): Promise<ForumTreeNode[]> {
	const { data: forums } = await forumApi.getAll<Forum>("/api/v1/forums");
	return buildVisibleTree(forums);
}
