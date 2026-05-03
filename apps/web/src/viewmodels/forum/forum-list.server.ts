// viewmodels/forum/forum-list.server.ts — Server-only data loader for forum list
// Calls Worker API (GET /api/v1/forums) via React cache()-backed helper.

import "server-only";

import { getForumList } from "@/lib/forum-data";
import type { ForumTreeNode } from "@ellie/types";
import { buildVisibleTree } from "./forum-list";

export async function loadForumList(): Promise<ForumTreeNode[]> {
	const forums = await getForumList();
	return buildVisibleTree(forums);
}
