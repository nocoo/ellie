import { buildQuoteSnippet, stripHtmlTags } from "@/lib/text";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// stripHtmlTags
// ---------------------------------------------------------------------------

describe("stripHtmlTags", () => {
	it("strips simple tags", () => {
		expect(stripHtmlTags("<p>hello</p>")).toBe("hello");
	});

	it("strips nested tags", () => {
		expect(stripHtmlTags("<div><p><strong>bold</strong> text</p></div>")).toBe("bold text");
	});

	it("strips self-closing tags", () => {
		expect(stripHtmlTags("line1<br/>line2")).toBe("line1line2");
		expect(stripHtmlTags("line1<br />line2")).toBe("line1line2");
	});

	it("strips tags with attributes", () => {
		expect(stripHtmlTags('<a href="https://example.com" target="_blank">link</a>')).toBe("link");
		expect(stripHtmlTags('<img src="photo.jpg" alt="A photo" />')).toBe("");
	});

	it("preserves HTML entities without decoding", () => {
		expect(stripHtmlTags("<p>&amp; &lt; &gt;</p>")).toBe("&amp; &lt; &gt;");
		expect(stripHtmlTags("&quot;quoted&quot;")).toBe("&quot;quoted&quot;");
	});

	it("returns empty string for empty input", () => {
		expect(stripHtmlTags("")).toBe("");
	});

	it("returns input unchanged if no tags present", () => {
		expect(stripHtmlTags("plain text without tags")).toBe("plain text without tags");
	});

	it("handles tags with newlines in attributes", () => {
		expect(stripHtmlTags('<div\nclass="foo"\nid="bar">content</div>')).toBe("content");
	});
});

// ---------------------------------------------------------------------------
// buildQuoteSnippet
// ---------------------------------------------------------------------------

describe("buildQuoteSnippet", () => {
	it("strips HTML and returns plain text", () => {
		expect(buildQuoteSnippet("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
	});

	it("returns full text when under maxLength", () => {
		const short = "Short text";
		expect(buildQuoteSnippet(short, 200)).toBe(short);
	});

	it("returns full text when exactly at maxLength", () => {
		const exact = "a".repeat(200);
		expect(buildQuoteSnippet(`<p>${exact}</p>`, 200)).toBe(exact);
	});

	it("truncates with ellipsis when over maxLength", () => {
		const long = "a".repeat(250);
		const result = buildQuoteSnippet(`<p>${long}</p>`, 200);
		expect(result).toBe(`${"a".repeat(200)}...`);
		expect(result.length).toBe(203); // 200 chars + "..."
	});

	it("uses default maxLength of 200", () => {
		const long = "b".repeat(300);
		const result = buildQuoteSnippet(long);
		expect(result).toBe(`${"b".repeat(200)}...`);
	});

	it("handles empty content", () => {
		expect(buildQuoteSnippet("")).toBe("");
		expect(buildQuoteSnippet("<p></p>")).toBe("");
	});

	it("handles content that becomes empty after stripping", () => {
		expect(buildQuoteSnippet("<br/><img src='x'/><hr/>")).toBe("");
	});

	it("handles maxLength = 0", () => {
		expect(buildQuoteSnippet("hello", 0)).toBe("...");
	});

	it("handles maxLength = 1", () => {
		expect(buildQuoteSnippet("hello", 1)).toBe("h...");
	});
});
