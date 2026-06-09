import { describe, expect, it } from "vitest";
import {
	canSubmit,
	emojiTokenToInsertion,
	isForumSmileyCode,
} from "@/viewmodels/forum/post-editor";

// ---------------------------------------------------------------------------
// canSubmit
// ---------------------------------------------------------------------------

describe("canSubmit", () => {
	it("thread mode: requires both subject and content", () => {
		expect(canSubmit("thread", "", "")).toBe(false);
		expect(canSubmit("thread", "Title", "")).toBe(false);
		expect(canSubmit("thread", "", "Content")).toBe(false);
		expect(canSubmit("thread", "Title", "Content")).toBe(true);
	});

	it("thread mode: trims whitespace", () => {
		expect(canSubmit("thread", "  ", "Content")).toBe(false);
		expect(canSubmit("thread", "Title", "  ")).toBe(false);
	});

	it("reply mode: requires only content", () => {
		expect(canSubmit("reply", "", "")).toBe(false);
		expect(canSubmit("reply", "", "Content")).toBe(true);
	});

	it("reply mode: ignores subject", () => {
		expect(canSubmit("reply", "anything", "")).toBe(false);
	});

	it("reply mode: trims whitespace", () => {
		expect(canSubmit("reply", "", "   ")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// emojiTokenToInsertion / isForumSmileyCode
//
// After the EmojiPicker + SmileyPicker unification (req msg=0c9265c6 +
// reviewer msg=017bd790), the editor receives a single onSelect string
// from `UnifiedEmojiPicker` for three sources (forum smiley / Unicode /
// recent). The helper decides whether to append a trailing space:
//   - forum smiley code (`:laugh:`, `:1:`, `{:2_133:}`, `{:3_149:}`) → `code `
//   - anything else (Unicode emoji native chars) → unchanged
// ---------------------------------------------------------------------------

describe("isForumSmileyCode", () => {
	it("matches default-pack named codes", () => {
		expect(isForumSmileyCode(":laugh:")).toBe(true);
		expect(isForumSmileyCode(":smile:")).toBe(true);
		expect(isForumSmileyCode(":cool:")).toBe(true);
		expect(isForumSmileyCode(":angel_smile:")).toBe(true);
	});

	it("matches default-pack numbered codes", () => {
		expect(isForumSmileyCode(":1:")).toBe(true);
		expect(isForumSmileyCode(":16:")).toBe(true);
	});

	it("matches coolmonkey / comcom codes", () => {
		expect(isForumSmileyCode("{:2_133:}")).toBe(true);
		expect(isForumSmileyCode("{:3_149:}")).toBe(true);
	});

	it("rejects Unicode emoji native characters", () => {
		expect(isForumSmileyCode("😀")).toBe(false);
		expect(isForumSmileyCode("😂")).toBe(false);
		expect(isForumSmileyCode("👍")).toBe(false);
	});

	it("rejects malformed strings", () => {
		expect(isForumSmileyCode("")).toBe(false);
		expect(isForumSmileyCode("laugh")).toBe(false);
		expect(isForumSmileyCode(":laugh")).toBe(false);
		expect(isForumSmileyCode("laugh:")).toBe(false);
		expect(isForumSmileyCode(":Laugh:")).toBe(false); // uppercase rejected
		expect(isForumSmileyCode(":la ugh:")).toBe(false); // space rejected
		expect(isForumSmileyCode("{:2_:}")).toBe(false);
	});
});

describe("emojiTokenToInsertion", () => {
	it("appends a trailing space to forum smiley codes", () => {
		expect(emojiTokenToInsertion(":laugh:")).toBe(":laugh: ");
		expect(emojiTokenToInsertion(":1:")).toBe(":1: ");
		expect(emojiTokenToInsertion("{:2_133:}")).toBe("{:2_133:} ");
		expect(emojiTokenToInsertion("{:3_149:}")).toBe("{:3_149:} ");
	});

	it("inserts Unicode emoji as-is (no trailing space)", () => {
		expect(emojiTokenToInsertion("😀")).toBe("😀");
		expect(emojiTokenToInsertion("👍")).toBe("👍");
		expect(emojiTokenToInsertion("❤️")).toBe("❤️");
	});

	it("inserts unrecognized strings as-is", () => {
		// Defensive: anything that doesn't match the smiley pattern is
		// forwarded untouched — the renderer would not turn it into an
		// <img> anyway, and we don't want to corrupt arbitrary text.
		expect(emojiTokenToInsertion("hello")).toBe("hello");
		expect(emojiTokenToInsertion("")).toBe("");
	});
});
