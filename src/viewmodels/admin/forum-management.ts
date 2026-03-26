// viewmodels/admin/forum-management.ts — Forum Management ViewModel
// Ref: 04c §版块管理 — tree view, edit, hide/show, reorder

import type { Repositories } from "@/data/index";
import type { UpdateForumInput } from "@/data/repositories/types";
import { type ForumTreeNode, buildForumTree } from "@/models/forum";
import type { Forum } from "@/models/types";

export interface ForumManagementActions {
	updateForum(id: number, data: UpdateForumInput): Promise<void>;
	toggleVisibility(id: number, currentStatus: number): Promise<void>;
	updateOrder(id: number, order: number): Promise<void>;
}

export interface ForumManagementData {
	tree: ForumTreeNode[];
	allForums: Forum[];
}

/** Fetch all forums and build tree */
export async function fetchForumTree(repos: Repositories): Promise<ForumManagementData> {
	const allForums = await repos.forums.listAll();
	const tree = buildForumTree(allForums);
	return { tree, allForums };
}

/** Create forum management actions */
export function createForumActions(repos: Repositories): ForumManagementActions {
	return {
		async updateForum(id: number, data: UpdateForumInput) {
			await repos.forums.update(id, data);
		},
		async toggleVisibility(id: number, currentStatus: number) {
			await repos.forums.update(id, { status: currentStatus === 1 ? 0 : 1 });
		},
		async updateOrder(id: number, order: number) {
			await repos.forums.update(id, { displayOrder: order });
		},
	};
}
