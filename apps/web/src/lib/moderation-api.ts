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

// ─── Thread Subject Edit (Author + Moderator) ────────────────────
//
// `PATCH /api/v1/threads/:id` is the unified subject-edit endpoint.
// Both thread authors (on open threads) and moderators converge on this
// one Worker handler, gated by `canEditThreadSubject`. The Worker:
//   - rejects empty / >200-char subjects with INVALID_BODY
//   - rejects banned content with CONTENT_BANNED
//   - returns `{ id, updated: boolean }` — `updated: false` when the
//     value is a semantic no-op (unchanged after trim + censor)
// Server-side cache invalidation (thread-meta + thread-list + forum-summary)
// is handled by the Worker; the caller then `router.refresh()` to refetch.
export interface EditThreadSubjectResponse {
	id: number;
	updated: boolean;
}

export async function editThreadSubject(
	threadId: number,
	subject: string,
): Promise<EditThreadSubjectResponse> {
	const { data } = await apiClient.patch<EditThreadSubjectResponse>(`/api/v1/threads/${threadId}`, {
		subject,
	});
	return data;
}

// ─── Recommended-threads card (Mod+) ─────────────────────────────
//
// `POST /api/v1/moderation/threads/:id/recommend` adds the thread to its
// forum's recommended-threads allowlist (migration 0045). The worker
// returns 200 with `{forumId, threadId, recommended: true}` and is
// idempotent (INSERT OR IGNORE). The data layer is uncapped; the
// forum-page card display layer slices to the newest 6.
//
// `DELETE /api/v1/moderation/threads/:id/recommend` removes the row and
// returns `{recommended: false}`. Also idempotent — a DELETE on a
// missing row still returns 200 so a double-click on "取消推荐" is safe.
export interface RecommendToggleResponse {
	forumId: number;
	threadId: number;
	recommended: boolean;
}

export async function recommendThread(threadId: number): Promise<RecommendToggleResponse> {
	const { data } = await apiClient.post<RecommendToggleResponse>(
		`/api/v1/moderation/threads/${threadId}/recommend`,
		undefined,
	);
	return data;
}

export async function unrecommendThread(threadId: number): Promise<RecommendToggleResponse> {
	const { data } = await apiClient.delete<RecommendToggleResponse>(
		`/api/v1/moderation/threads/${threadId}/recommend`,
	);
	return data;
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
