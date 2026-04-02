// lib/moderation-api.ts — Frontend moderation API calls
// Wraps Worker /api/v1/moderation/* and /api/v1/me/* endpoints

import { apiClient } from "./api-client";

// ─── Thread Management (Mod+) ────────────────────────────────────

export type StickyLevel = "none" | "forum" | "global";

export async function setThreadSticky(threadId: number, level: StickyLevel): Promise<void> {
	await apiClient.patch(`/api/v1/moderation/threads/${threadId}/sticky`, { level });
}

export async function setThreadDigest(threadId: number, level: number): Promise<void> {
	await apiClient.patch(`/api/v1/moderation/threads/${threadId}/digest`, { level });
}

export async function setThreadClosed(threadId: number, closed: boolean): Promise<void> {
	await apiClient.patch(`/api/v1/moderation/threads/${threadId}/close`, { closed });
}

export async function moveThread(threadId: number, targetForumId: number): Promise<void> {
	await apiClient.patch(`/api/v1/moderation/threads/${threadId}/move`, { targetForumId });
}

export interface HighlightOptions {
	color: string | null;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
}

export async function setThreadHighlight(
	threadId: number,
	options: HighlightOptions,
): Promise<void> {
	await apiClient.patch(`/api/v1/moderation/threads/${threadId}/highlight`, options);
}

export async function deleteThread(threadId: number): Promise<void> {
	await apiClient.delete(`/api/v1/moderation/threads/${threadId}`);
}

// ─── Post Management (Mod+) ──────────────────────────────────────

export async function deletePost(postId: number): Promise<void> {
	await apiClient.delete(`/api/v1/moderation/posts/${postId}`);
}

export async function editPost(postId: number, content: string): Promise<void> {
	await apiClient.patch(`/api/v1/moderation/posts/${postId}`, { content });
}

// ─── User Self-Service ───────────────────────────────────────────

export async function deleteMyPost(postId: number): Promise<void> {
	await apiClient.delete(`/api/v1/me/posts/${postId}`);
}

export async function deleteMyThread(threadId: number): Promise<void> {
	await apiClient.delete(`/api/v1/me/threads/${threadId}`);
}

export async function editMyPost(postId: number, content: string): Promise<void> {
	await apiClient.patch(`/api/v1/me/posts/${postId}`, { content });
}
