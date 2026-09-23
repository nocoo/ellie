// viewmodels/forum/forum-list.server.ts — Server-only data loader for forum list
// Doc/29: structure view (JWT forwarded) + per-forum runtime-cached summaries
// + fresh per-render gates.

import "server-only";

import type { Forum, ForumTreeNode } from "@ellie/types";
import { getWorkerJwt } from "@/lib/forum-auth";
import { getCachedForumStructure } from "@/lib/forum-cache";
import {
	composeForumDisplay,
	loadForumSummariesWithGates,
	visibilityContextForBucket,
} from "@/lib/forum-reading";
import { buildVisibleTree } from "./forum-list";

export interface ForumListResult {
	tree: ForumTreeNode[];
	/** Forums whose latest-topic line is hidden by current gates. */
	hiddenTopicForumIds: number[];
}

export async function loadForumList(): Promise<ForumTreeNode[]> {
	return (await loadForumListDetailed()).tree;
}

export async function loadForumListDetailed(): Promise<ForumListResult> {
	const jwt = await getWorkerJwt();
	const { forums, bucket } = await getCachedForumStructure(jwt);
	const summaries = await loadForumSummariesWithGates({
		jwt,
		bucket,
		forumIds: forums.map((forum) => forum.id),
	});
	const byForum = new Map(summaries.summaries.map((summary) => [summary.forumId, summary]));
	const gateByForum = new Map(summaries.gates.map((gate) => [gate.forumId, gate]));
	const display: Forum[] = forums.map(
		(structure) =>
			composeForumDisplay({
				structure,
				summary: byForum.get(structure.id),
				gate: gateByForum.get(structure.id),
				bucket: summaries.bucket,
			}).forum,
	);
	return {
		tree: buildVisibleTree(display, visibilityContextForBucket(summaries.bucket)),
		hiddenTopicForumIds: summaries.hiddenTopicForumIds,
	};
}
