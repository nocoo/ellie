import { sanitizeInlineHtml } from "@/lib/safe-html";
import { describe, expect, test } from "vitest";

describe("sanitizeInlineHtml", () => {
	// ── Basic pass-through ──────────────────────────────────────────

	test("returns empty string for null/undefined/empty", () => {
		expect(sanitizeInlineHtml(null)).toBe("");
		expect(sanitizeInlineHtml(undefined)).toBe("");
		expect(sanitizeInlineHtml("")).toBe("");
	});

	test("passes plain text through unchanged", () => {
		expect(sanitizeInlineHtml("Hello world")).toBe("Hello world");
	});

	test("preserves HTML entities", () => {
		expect(sanitizeInlineHtml("&amp; &lt; &gt;")).toBe("&amp; &lt; &gt;");
	});

	// ── Whitelisted tags ────────────────────────────────────────────

	test("keeps <strong> tags", () => {
		expect(sanitizeInlineHtml("<strong>bold</strong>")).toBe("<strong>bold</strong>");
	});

	test("keeps <b>, <em>, <i>, <u>, <s> tags", () => {
		expect(sanitizeInlineHtml("<b>b</b><em>em</em><i>i</i><u>u</u><s>s</s>")).toBe(
			"<b>b</b><em>em</em><i>i</i><u>u</u><s>s</s>",
		);
	});

	test("keeps <br> tags", () => {
		expect(sanitizeInlineHtml("line1<br>line2")).toBe("line1<br>line2");
		expect(sanitizeInlineHtml("line1<br/>line2")).toBe("line1<br>line2");
		expect(sanitizeInlineHtml("line1<br />line2")).toBe("line1<br>line2");
	});

	test("keeps <font color> with color attribute", () => {
		expect(sanitizeInlineHtml('<font color="red">text</font>')).toBe(
			'<font color="red">text</font>',
		);
		expect(sanitizeInlineHtml('<font color="#ff0000">text</font>')).toBe(
			'<font color="#ff0000">text</font>',
		);
	});

	test("keeps <span style='color: ...'> for color styling", () => {
		expect(sanitizeInlineHtml('<span style="color: red">text</span>')).toBe(
			'<span style="color: red">text</span>',
		);
		expect(sanitizeInlineHtml('<span style="color: #f00;">text</span>')).toBe(
			'<span style="color: #f00;">text</span>',
		);
	});

	test("keeps <a> with href, adds rel and target", () => {
		const result = sanitizeInlineHtml('<a href="https://example.com">link</a>');
		expect(result).toContain('href="https://example.com"');
		expect(result).toContain('rel="nofollow noopener"');
		expect(result).toContain('target="_blank"');
		expect(result).toContain("link</a>");
	});

	test("keeps <a> with existing rel and target", () => {
		const result = sanitizeInlineHtml('<a href="/foo" rel="noopener" target="_self">link</a>');
		expect(result).toContain('rel="noopener"');
		expect(result).toContain('target="_self"');
	});

	// ── Real-world forum description ────────────────────────────────

	test("handles forum description with mixed HTML", () => {
		const input = "同济之痒 <strong>[同济建设]</strong>同济人，同济事，同济快讯一览无遗。";
		const result = sanitizeInlineHtml(input);
		expect(result).toBe("同济之痒 <strong>[同济建设]</strong>同济人，同济事，同济快讯一览无遗。");
	});

	// ── Stripped tags ───────────────────────────────────────────────

	test("strips <script> tags but keeps content", () => {
		expect(sanitizeInlineHtml("<script>alert(1)</script>")).toBe("alert(1)");
	});

	test("strips <img> tags", () => {
		expect(sanitizeInlineHtml('<img src="x.jpg" onerror="alert(1)">')).toBe("");
	});

	test("strips <div>, <p>, <h1> and other block tags", () => {
		expect(sanitizeInlineHtml("<div>text</div>")).toBe("text");
		expect(sanitizeInlineHtml("<p>paragraph</p>")).toBe("paragraph");
		expect(sanitizeInlineHtml("<h1>heading</h1>")).toBe("heading");
	});

	test("strips <iframe> tags", () => {
		expect(sanitizeInlineHtml('<iframe src="evil.html"></iframe>')).toBe("");
	});

	// ── Attribute filtering ─────────────────────────────────────────

	test("strips non-whitelisted attributes from allowed tags", () => {
		expect(sanitizeInlineHtml('<strong onclick="alert(1)">text</strong>')).toBe(
			"<strong>text</strong>",
		);
	});

	test("strips non-color attributes from <font>", () => {
		expect(sanitizeInlineHtml('<font face="Arial" color="red">text</font>')).toBe(
			'<font color="red">text</font>',
		);
	});

	test("strips unsafe style properties from <span>", () => {
		expect(sanitizeInlineHtml('<span style="background: url(evil)">text</span>')).toBe(
			"<span>text</span>",
		);
	});

	// ── XSS prevention ──────────────────────────────────────────────

	test("blocks javascript: in href", () => {
		const result = sanitizeInlineHtml('<a href="javascript:alert(1)">xss</a>');
		expect(result).not.toContain("javascript:");
	});

	test("blocks data: in href", () => {
		const result = sanitizeInlineHtml('<a href="data:text/html,<script>alert(1)</script>">xss</a>');
		expect(result).not.toContain("data:");
	});

	test("blocks vbscript: in href", () => {
		const result = sanitizeInlineHtml('<a href="vbscript:alert(1)">xss</a>');
		expect(result).not.toContain("vbscript:");
	});
});
