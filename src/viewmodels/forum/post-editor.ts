// viewmodels/forum/post-editor.ts — Post editor ViewModel
// Ref: 04d §发帖与回帖 — submit/canSubmit/validation logic

import type { Repositories } from "@/data/index";
import type { Thread } from "@/models/types";

export type EditorMode = "thread" | "reply";

export interface PostEditorState {
	mode: EditorMode;
	subject: string;
	content: string;
	forumId: number;
	threadId?: number;
}

export interface SubmitResult {
	success: boolean;
	threadId?: number;
	error?: string;
}

/**
 * Validate if the editor state is ready to submit.
 * Pure function, exported for testing.
 */
export function canSubmit(state: PostEditorState): boolean {
	if (state.mode === "thread") {
		return state.subject.trim().length > 0 && state.content.trim().length > 0;
	}
	return state.content.trim().length > 0;
}

/**
 * Validate subject length (max 80 chars).
 * Pure function, exported for testing.
 */
export function validateSubject(subject: string): string | null {
	if (subject.trim().length === 0) return "Subject is required";
	if (subject.trim().length > 80) return "Subject must be 80 characters or less";
	return null;
}

/**
 * Validate content length (min 1, max 50000 chars).
 * Pure function, exported for testing.
 */
export function validateContent(content: string): string | null {
	if (content.trim().length === 0) return "Content is required";
	if (content.trim().length > 50000) return "Content is too long (max 50,000 characters)";
	return null;
}

/**
 * Submit a new thread or reply.
 */
export async function submitPost(
	repos: Repositories,
	state: PostEditorState,
	authorId: number,
	authorName: string,
): Promise<SubmitResult> {
	if (!canSubmit(state)) {
		return { success: false, error: "Invalid submission" };
	}

	try {
		if (state.mode === "thread") {
			const thread: Thread = await repos.threads.create({
				forumId: state.forumId,
				authorId,
				authorName,
				subject: state.subject.trim(),
				content: state.content.trim(),
			});
			return { success: true, threadId: thread.id };
		}

		if (!state.threadId) {
			return { success: false, error: "Thread ID is required for replies" };
		}

		await repos.posts.create({
			threadId: state.threadId,
			authorId,
			authorName,
			content: state.content.trim(),
		});
		return { success: true };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
}
