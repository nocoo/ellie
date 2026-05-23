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

// ---------------------------------------------------------------------------
// Emoji token insertion — preserve original per-type behavior after the
// EmojiPicker / SmileyPicker unification (req msg=0c9265c6, reviewer
// msg=017bd790).
//
// `UnifiedEmojiPicker` emits a single string from a unified `onSelect` for
// three sources:
//   - forum smiley code: `:laugh:` / `:1:` / `{:2_133:}` / `{:3_149:}`
//   - Unicode emoji native character (any other string)
//   - Recent: either of the above
//
// History: the old `SmileyPicker` appended a trailing space because the
// `:` terminator collides with the next typed character (`:laugh:foo`
// would never round-trip). The old `EmojiPicker`, in contrast, inserted
// `😀` with no trailing space because Unicode emojis are self-delimiting.
// After unification the editor must keep both behaviors so old users
// don't see a regression. This helper centralizes that rule so the
// editor and unit tests reference the same source of truth.
//
// Patterns recognized as forum smiley codes:
//   - `:[a-z0-9_]+:` — default pack named (`:laugh:`) + numbered (`:1:`)
//   - `\{:[0-9]+_[0-9]+:\}` — coolmonkey/comcom (`{:2_133:}`, `{:3_149:}`)
// ---------------------------------------------------------------------------

const FORUM_SMILEY_CODE = /^(:[a-z0-9_]+:|\{:[0-9]+_[0-9]+:\})$/;

/** True for a token that the renderer treats as a forum smiley code. */
export function isForumSmileyCode(token: string): boolean {
	return FORUM_SMILEY_CODE.test(token);
}

/**
 * Map an emoji-picker token to the exact string the editor should insert.
 *
 * Forum smiley codes get a trailing space so the closing `:` does not
 * collide with the next typed character. Unicode emoji characters are
 * inserted as-is, matching the pre-unification `EmojiPicker` behavior.
 */
export function emojiTokenToInsertion(token: string): string {
	return isForumSmileyCode(token) ? `${token} ` : token;
}
