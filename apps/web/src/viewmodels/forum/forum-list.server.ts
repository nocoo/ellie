// viewmodels/forum/forum-list.server.ts — Server-only data loader for forum list
// Calls repositories directly (mock phase). Phase 2 replaces with Worker API.

import { createRepositories } from "@ellie/repositories";
import type { ForumTreeNode } from "@ellie/types";
import { buildVisibleTree } from "./forum-list";

export async function loadForumList(): Promise<ForumTreeNode[]> {
	const repos = createRepositories();
	const forums = await repos.forums.listAll();
	return buildVisibleTree(forums);
}
