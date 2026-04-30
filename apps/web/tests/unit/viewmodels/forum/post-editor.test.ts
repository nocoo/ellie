import { canSubmit } from "@/viewmodels/forum/post-editor";
import { describe, expect, it } from "vitest";

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
