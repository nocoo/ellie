// viewmodels/forum/forum-list.server.ts — Server-only data loader for forum list
// Calls Worker API (GET /api/v1/forums) via React cache()-backed helper.

import "server-only";

import { getCachedForumList } from "@/lib/forum-cache";
import type { ForumTreeNode } from "@ellie/types";
import { buildVisibleTree } from "./forum-list";

export async function loadForumList(): Promise<ForumTreeNode[]> {
	const forums = await getCachedForumList();
	return buildVisibleTree(forums);
}
