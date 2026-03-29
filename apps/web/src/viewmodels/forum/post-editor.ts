// viewmodels/forum/post-editor.ts — Post editor pure logic
// Ref: 04d §PostEditor — submit/canSubmit/validation

import type { Repositories } from "@ellie/repositories";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditorMode = "thread" | "reply";

export interface SubmitResult {
	success: boolean;
	threadId?: number;
	error?: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Check whether the editor content is valid for submission. */
export function canSubmit(mode: EditorMode, subject: string, content: string): boolean {
	if (mode === "thread") {
		return subject.trim().length > 0 && content.trim().length > 0;
	}
	return content.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** Submit a new thread or reply via the repository layer. */
export async function submitPost(
	repos: Repositories,
	mode: EditorMode,
	targetId: number,
	subject: string,
	content: string,
	authorId: number,
	authorName: string,
): Promise<SubmitResult> {
	try {
		if (mode === "thread") {
			const thread = await repos.threads.create({
				forumId: targetId,
				subject,
				content,
				authorId,
				authorName,
			});
			return { success: true, threadId: thread.id };
		}
		await repos.posts.create({
			threadId: targetId,
			content,
			authorId,
			authorName,
		});
		return { success: true };
	} catch (err) {
		return { success: false, error: (err as Error).message };
	}
}
