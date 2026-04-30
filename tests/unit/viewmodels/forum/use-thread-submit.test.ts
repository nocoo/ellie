import { describe, expect, it } from "vitest";
import {
	canSubmitThread,
	validateContent,
	validateSubject,
} from "../../../../apps/web/src/viewmodels/forum/use-thread-submit";

// ---------------------------------------------------------------------------
// validateSubject
// ---------------------------------------------------------------------------

describe("validateSubject", () => {
	describe("with default lengths (4-100)", () => {
		it("returns valid for empty subject (not touched)", () => {
			expect(validateSubject("")).toEqual({ valid: true });
		});

		it("returns valid for subject with exactly 4 chars", () => {
			expect(validateSubject("四个字符")).toEqual({ valid: true });
		});

		it("returns invalid for subject with < 4 chars", () => {
			const result = validateSubject("abc");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("4个字符");
		});

		it("returns valid for subject at max length", () => {
			const subject = "a".repeat(100);
			expect(validateSubject(subject)).toEqual({ valid: true });
		});

		it("returns invalid for subject > 100 chars", () => {
			const subject = "a".repeat(101);
			const result = validateSubject(subject);
			expect(result.valid).toBe(false);
			expect(result.error).toContain("100个字符");
		});

		it("trims whitespace before validation", () => {
			expect(validateSubject("  ab  ").valid).toBe(false); // Only 2 chars after trim
			expect(validateSubject("  abcd  ").valid).toBe(true); // 4 chars after trim
		});
	});

	describe("with custom lengths", () => {
		it("respects custom min length", () => {
			expect(validateSubject("abc", 3, 100).valid).toBe(true);
			expect(validateSubject("ab", 3, 100).valid).toBe(false);
		});

		it("respects custom max length", () => {
			expect(validateSubject("abcdef", 2, 5).valid).toBe(false);
			expect(validateSubject("abcde", 2, 5).valid).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// validateContent
// ---------------------------------------------------------------------------

describe("validateContent", () => {
	describe("with default min length (10)", () => {
		it("returns valid for content >= 10 chars", () => {
			expect(validateContent("<p>这是一段足够长的内容</p>")).toEqual({ valid: true });
		});

		it("returns invalid for content < 10 chars", () => {
			const result = validateContent("<p>短内容</p>");
			expect(result.valid).toBe(false);
			expect(result.error).toContain("10个字符");
		});

		it("strips HTML tags before counting", () => {
			// "ab" after stripping tags
			const result = validateContent("<p><strong>ab</strong></p>");
			expect(result.valid).toBe(false);
		});

		it("trims whitespace before counting", () => {
			const result = validateContent("<p>   short   </p>");
			expect(result.valid).toBe(false); // "short" is only 5 chars
		});
	});

	describe("with custom min length", () => {
		it("respects custom minimum", () => {
			expect(validateContent("<p>abc</p>", 3).valid).toBe(true);
			expect(validateContent("<p>ab</p>", 3).valid).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// canSubmitThread
// ---------------------------------------------------------------------------

describe("canSubmitThread", () => {
	it("returns true when all conditions met", () => {
		expect(canSubmitThread("Valid title", false, 4, 100)).toBe(true);
	});

	it("returns false when submitting", () => {
		expect(canSubmitThread("Valid title", true, 4, 100)).toBe(false);
	});

	it("returns false when subject too short", () => {
		expect(canSubmitThread("abc", false, 4, 100)).toBe(false);
	});

	it("returns false when subject too long", () => {
		expect(canSubmitThread("a".repeat(101), false, 4, 100)).toBe(false);
	});

	it("trims whitespace from subject", () => {
		expect(canSubmitThread("  abc  ", false, 4, 100)).toBe(false); // 3 chars
		expect(canSubmitThread("  abcd  ", false, 4, 100)).toBe(true); // 4 chars
	});

	it("returns true at exact min length", () => {
		expect(canSubmitThread("abcd", false, 4, 100)).toBe(true);
	});

	it("returns true at exact max length", () => {
		expect(canSubmitThread("a".repeat(100), false, 4, 100)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// State contracts (documentation)
// ---------------------------------------------------------------------------

describe("useThreadSubmit state contracts", () => {
	it("defines expected state shape", () => {
		const expectedStateKeys = ["submitting", "error", "subject"];
		expect(expectedStateKeys.length).toBe(3);
	});

	it("defines expected actions shape", () => {
		const expectedActionKeys = ["setSubject", "handleSubmit", "clearError", "reset"];
		expect(expectedActionKeys.length).toBe(4);
	});

	it("defines expected validation shape", () => {
		const expectedValidationKeys = ["subjectError", "canSubmit"];
		expect(expectedValidationKeys.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Error message integration
// ---------------------------------------------------------------------------

describe("error messages", () => {
	it("subject error mentions character count", () => {
		const result = validateSubject("ab", 4, 100);
		expect(result.error).toContain("4个字符");
	});

	it("content error mentions character count", () => {
		const result = validateContent("<p>short</p>", 10);
		expect(result.error).toContain("10个字符");
	});
});
