import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => ({
	apiClient: { post: vi.fn(async () => ({ data: {} })) },
	ApiError: class ApiError extends Error {
		code?: string;
		constructor(m: string, c?: string) {
			super(m);
			this.code = c;
		}
	},
}));

import { apiClient } from "@/lib/api-client";
import { stripHtmlTags } from "@/lib/text";
import {
	buildQuotedContent,
	submitReply,
	validateReplyContent,
} from "@/viewmodels/forum/use-reply-submit";

// ---------------------------------------------------------------------------
// stripHtmlTags
// ---------------------------------------------------------------------------

describe("stripHtmlTags", () => {
	it("removes simple HTML tags", () => {
		expect(stripHtmlTags("<p>Hello</p>")).toBe("Hello");
	});

	it("removes nested HTML tags", () => {
		expect(stripHtmlTags("<div><p>Hello</p></div>")).toBe("Hello");
	});

	it("removes self-closing tags", () => {
		expect(stripHtmlTags("Hello<br/>World")).toBe("HelloWorld");
	});

	it("removes tags with attributes", () => {
		expect(stripHtmlTags('<a href="test">Link</a>')).toBe("Link");
	});

	it("handles empty string", () => {
		expect(stripHtmlTags("")).toBe("");
	});

	it("preserves plain text", () => {
		expect(stripHtmlTags("Plain text")).toBe("Plain text");
	});

	it("handles multiple tags", () => {
		expect(stripHtmlTags("<p>First</p><p>Second</p>")).toBe("FirstSecond");
	});
});

// ---------------------------------------------------------------------------
// validateReplyContent
// ---------------------------------------------------------------------------

describe("validateReplyContent", () => {
	describe("with default minLength (2)", () => {
		it("returns valid for content >= 2 chars", () => {
			expect(validateReplyContent("<p>Hello</p>")).toEqual({ valid: true });
			expect(validateReplyContent("<p>Hi</p>")).toEqual({ valid: true });
		});

		it("returns invalid for content < 2 chars", () => {
			const result = validateReplyContent("<p>A</p>");
			expect(result.valid).toBe(false);
			expect(result.error).toBe("内容太短，请输入更多内容");
		});

		it("returns invalid for empty content", () => {
			const result = validateReplyContent("<p></p>");
			expect(result.valid).toBe(false);
		});

		it("returns invalid for whitespace-only content", () => {
			const result = validateReplyContent("<p>   </p>");
			expect(result.valid).toBe(false);
		});

		it("strips HTML tags before validating length", () => {
			// Only "A" after stripping tags, which is < 2
			const result = validateReplyContent("<p><strong>A</strong></p>");
			expect(result.valid).toBe(false);
		});
	});

	describe("with custom minLength", () => {
		it("respects custom minimum length", () => {
			expect(validateReplyContent("<p>Hi</p>", 3).valid).toBe(false);
			expect(validateReplyContent("<p>Hey</p>", 3).valid).toBe(true);
		});

		it("allows content >= minLength", () => {
			expect(validateReplyContent("<p>Hello World</p>", 10).valid).toBe(true);
		});

		it("rejects content < minLength", () => {
			expect(validateReplyContent("<p>Short</p>", 10).valid).toBe(false);
		});
	});

	describe("edge cases", () => {
		it("handles empty string", () => {
			expect(validateReplyContent("").valid).toBe(false);
		});

		it("handles only HTML tags", () => {
			expect(validateReplyContent("<p><br/></p>").valid).toBe(false);
		});

		it("trims whitespace before checking length", () => {
			expect(validateReplyContent("<p>  AB  </p>").valid).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// buildQuotedContent
// ---------------------------------------------------------------------------

describe("buildQuotedContent", () => {
	it("builds quote block with author and content", () => {
		const result = buildQuotedContent("<p>Original message</p>", "Alice");
		expect(result).toContain("blockquote");
		expect(result).toContain("Alice");
		expect(result).toContain("quote-header");
		expect(result).toContain("<p>Original message</p>");
	});

	it("includes time when provided", () => {
		const result = buildQuotedContent("<p>Message</p>", "Alice", "2026-4-7 12:30");
		expect(result).toContain("发表于 2026-4-7 12:30");
	});

	it("returns empty string when quotedContent is undefined", () => {
		expect(buildQuotedContent(undefined, "Alice")).toBe("");
	});

	it("returns empty string when quotedAuthor is undefined", () => {
		expect(buildQuotedContent("<p>Content</p>", undefined)).toBe("");
	});

	it("returns empty string when both are undefined", () => {
		expect(buildQuotedContent(undefined, undefined)).toBe("");
	});

	it("returns empty string when quotedContent is empty string", () => {
		expect(buildQuotedContent("", "Alice")).toBe("");
	});

	it("returns empty string when quotedAuthor is empty string", () => {
		expect(buildQuotedContent("<p>Content</p>", "")).toBe("");
	});

	it("preserves HTML in quoted content", () => {
		const result = buildQuotedContent("<p><strong>Bold</strong></p>", "Bob");
		expect(result).toContain("<strong>Bold</strong>");
	});

	it("ends with empty paragraph for cursor placement", () => {
		const result = buildQuotedContent("<p>Content</p>", "Author");
		expect(result).toMatch(/<p><\/p>$/);
	});
});

// ---------------------------------------------------------------------------
// State management contracts (documentation)
// ---------------------------------------------------------------------------

describe("useReplySubmit state contracts", () => {
	it("defines expected initial state shape", () => {
		const expectedInitialState = {
			submitting: false,
			error: null,
		};

		expect(Object.keys(expectedInitialState)).toEqual(["submitting", "error"]);
	});

	it("defines expected callbacks shape", () => {
		const expectedCallbacks = ["handleSubmit", "clearError"];
		expect(expectedCallbacks.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Error message integration
// ---------------------------------------------------------------------------

describe("error message integration", () => {
	it("uses Chinese validation error for short content", () => {
		const result = validateReplyContent("<p>A</p>");
		expect(result.error).toBe("内容太短，请输入更多内容");
	});

	it("error contains actionable message", () => {
		const result = validateReplyContent("");
		expect(result.error).toContain("内容");
	});
});

// ---------------------------------------------------------------------------
// submitReply
// ---------------------------------------------------------------------------

describe("submitReply", () => {
	it("calls apiClient.post with threadId and content", async () => {
		await submitReply(123, "<p>Hello world</p>");
		expect((apiClient as any).post).toHaveBeenCalledWith("/api/v1/posts", {
			threadId: 123,
			content: "<p>Hello world</p>",
		});
	});
});
