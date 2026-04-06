import { type PaginatedResponse, apiClient } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Forum type — group (分区), forum (版块), sub (子版块) */
export type ForumType = "group" | "forum" | "sub";

export interface Forum {
	id: number;
	parentId: number;
	name: string;
	description: string;
	icon: string;
	displayOrder: number;
	threads: number;
	posts: number;
	type: ForumType;
	status: number;
	moderators: string;
	lastThreadId: number;
	lastPostAt: number;
	lastPoster: string;
	lastThreadSubject: string;
}

/** Tree node extends Forum with computed children */
export interface ForumTreeNode extends Forum {
	children: ForumTreeNode[];
	depth: number;
}

export interface ForumCreate {
	name: string;
	description?: string;
	displayOrder?: number;
	status?: number;
	type?: ForumType;
	parentId?: number;
	icon?: string;
}

export interface ForumUpdate {
	name?: string;
	description?: string;
	displayOrder?: number;
	status?: number;
	type?: ForumType;
	parentId?: number;
	icon?: string;
}

export interface MergeResult {
	merged: boolean;
	movedThreads: number;
}

export interface ReorderItem {
	id: number;
	displayOrder: number;
}

export interface ReorderResult {
	reordered: boolean;
}

export interface DeleteResult {
	deleted: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Map forum status number to display label. Worker uses 0=hidden, 1=active. */
export function statusLabel(status: number): string {
	switch (status) {
		case 0:
			return "隐藏";
		case 1:
			return "正常";
		default:
			return "未知";
	}
}

/** Map forum type to display label */
export function typeLabel(type: ForumType): string {
	switch (type) {
		case "group":
			return "分区";
		case "forum":
			return "版块";
		case "sub":
			return "子版块";
		default:
			return "未知";
	}
}

/** Build a tree structure from flat forum list */
export function buildForumTree(forums: Forum[]): ForumTreeNode[] {
	const nodeMap = new Map<number, ForumTreeNode>();
	const roots: ForumTreeNode[] = [];

	// Create nodes
	for (const forum of forums) {
		nodeMap.set(forum.id, { ...forum, children: [], depth: 0 });
	}

	// Build tree
	for (const forum of forums) {
		const node = nodeMap.get(forum.id);
		if (!node) continue;

		if (forum.parentId === 0) {
			node.depth = 0;
			roots.push(node);
		} else {
			const parent = nodeMap.get(forum.parentId);
			if (parent) {
				node.depth = parent.depth + 1;
				parent.children.push(node);
			} else {
				// Orphan node, treat as root
				node.depth = 0;
				roots.push(node);
			}
		}
	}

	// Sort children by displayOrder
	const sortNodes = (nodes: ForumTreeNode[]) => {
		nodes.sort((a, b) => a.displayOrder - b.displayOrder);
		for (const node of nodes) {
			sortNodes(node.children);
		}
	};
	sortNodes(roots);

	return roots;
}

/** Flatten tree to list with depth info for rendering */
export function flattenForumTree(nodes: ForumTreeNode[]): ForumTreeNode[] {
	const result: ForumTreeNode[] = [];
	const traverse = (list: ForumTreeNode[]) => {
		for (const node of list) {
			result.push(node);
			traverse(node.children);
		}
	};
	traverse(nodes);
	return result;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export async function fetchForums(): Promise<PaginatedResponse<Forum>> {
	return apiClient.getList<Forum>("/api/admin/forums");
}

export async function fetchForum(id: number): Promise<Forum> {
	const res = await apiClient.get<Forum>(`/api/admin/forums/${id}`);
	return res.data;
}

export async function createForum(data: ForumCreate): Promise<Forum> {
	const res = await apiClient.post<Forum>("/api/admin/forums", data);
	return res.data;
}

export async function updateForum(id: number, data: ForumUpdate): Promise<Forum> {
	const res = await apiClient.patch<Forum>(`/api/admin/forums/${id}`, data);
	return res.data;
}

export async function deleteForum(id: number): Promise<DeleteResult> {
	const res = await apiClient.delete<DeleteResult>(`/api/admin/forums/${id}`);
	return res.data;
}

export async function mergeForums(sourceId: number, targetForumId: number): Promise<MergeResult> {
	const res = await apiClient.post<MergeResult>(`/api/admin/forums/${sourceId}/merge`, {
		targetForumId,
	});
	return res.data;
}

export async function reorderForums(orders: ReorderItem[]): Promise<ReorderResult> {
	const res = await apiClient.post<ReorderResult>("/api/admin/forums/reorder", { orders });
	return res.data;
}
