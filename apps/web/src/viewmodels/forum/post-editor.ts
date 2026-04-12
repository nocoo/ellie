// viewmodels/forum/post-editor.ts — Post editor pure logic
// Ref: 04d §PostEditor — canSubmit validation

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditorMode = "thread" | "reply";

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
