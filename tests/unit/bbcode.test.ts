import { describe, expect, test } from "bun:test";
import { bbcodeToHtml, escapeHtml } from "../../scripts/migrate/transform/bbcode";

describe("escapeHtml", () => {
	test('escapes &, <, >, "', () => {
		expect(escapeHtml('a & b < c > d "e"')).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
	});

	test("empty string", () => {
		expect(escapeHtml("")).toBe("");
	});

	test("no special chars", () => {
		expect(escapeHtml("hello world")).toBe("hello world");
	});
});

describe("bbcodeToHtml", () => {
	test("empty string", () => {
		expect(bbcodeToHtml("")).toBe("");
	});

	test("plain text (no BBCode)", () => {
		expect(bbcodeToHtml("Hello world")).toBe("Hello world");
	});

	test("[b] bold", () => {
		expect(bbcodeToHtml("[b]bold[/b]")).toBe("<strong>bold</strong>");
	});

	test("[i] italic", () => {
		expect(bbcodeToHtml("[i]italic[/i]")).toBe("<em>italic</em>");
	});

	test("[u] underline", () => {
		expect(bbcodeToHtml("[u]underline[/u]")).toBe("<u>underline</u>");
	});

	test("[s] strikethrough", () => {
		expect(bbcodeToHtml("[s]deleted[/s]")).toBe("<s>deleted</s>");
	});

	test("[quote] blockquote", () => {
		expect(bbcodeToHtml("[quote]quoted text[/quote]")).toBe("<blockquote>quoted text</blockquote>");
	});

	test("[code] code block", () => {
		expect(bbcodeToHtml("[code]let x = 1;[/code]")).toBe("<pre><code>let x = 1;</code></pre>");
	});

	test("[url=href]text[/url]", () => {
		expect(bbcodeToHtml("[url=https://example.com]click[/url]")).toBe(
			'<a href="https://example.com">click</a>',
		);
	});

	test("[url]href[/url]", () => {
		expect(bbcodeToHtml("[url]https://example.com[/url]")).toBe(
			'<a href="https://example.com">https://example.com</a>',
		);
	});

	test("[img]src[/img]", () => {
		expect(bbcodeToHtml("[img]https://example.com/pic.jpg[/img]")).toBe(
			'<img src="https://example.com/pic.jpg">',
		);
	});

	test("[color=red]text[/color]", () => {
		expect(bbcodeToHtml("[color=red]red text[/color]")).toBe(
			'<span style="color:red">red text</span>',
		);
	});

	test("[color=#FF0000]text[/color]", () => {
		expect(bbcodeToHtml("[color=#FF0000]colored[/color]")).toBe(
			'<span style="color:#FF0000">colored</span>',
		);
	});

	test("[size=N]text[/size] with named sizes", () => {
		expect(bbcodeToHtml("[size=4]large text[/size]")).toBe(
			'<span style="font-size:large">large text</span>',
		);
	});

	test("[size=N]text[/size] with pixel fallback", () => {
		expect(bbcodeToHtml("[size=16]custom[/size]")).toBe(
			'<span style="font-size:16px">custom</span>',
		);
	});

	test("[align=center]text[/align]", () => {
		expect(bbcodeToHtml("[align=center]centered[/align]")).toBe(
			'<div style="text-align:center">centered</div>',
		);
	});

	test("[attach]aid[/attach] placeholder", () => {
		expect(bbcodeToHtml("[attach]12345[/attach]")).toBe(
			'<attachment data-aid="12345"></attachment>',
		);
	});

	test("nested tags", () => {
		expect(bbcodeToHtml("[b][i]bold italic[/i][/b]")).toBe("<strong><em>bold italic</em></strong>");
	});

	test("nested color inside bold", () => {
		expect(bbcodeToHtml("[b][color=red]bold red[/color][/b]")).toBe(
			'<strong><span style="color:red">bold red</span></strong>',
		);
	});

	test("case insensitive tags", () => {
		expect(bbcodeToHtml("[B]BOLD[/B]")).toBe("<strong>BOLD</strong>");
	});

	test("bbcodeoff: treats content as plain text", () => {
		const result = bbcodeToHtml("[b]not bold[/b]", { bbcodeoff: true });
		expect(result).toBe("[b]not bold[/b]");
		expect(result).not.toContain("<strong>");
	});

	test("bbcodeoff: escapes HTML in content", () => {
		const result = bbcodeToHtml("<script>alert(1)</script>", { bbcodeoff: true });
		expect(result).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("htmlon: preserves raw HTML", () => {
		const result = bbcodeToHtml("<b>html bold</b> [i]bbcode italic[/i]", { htmlon: true });
		expect(result).toContain("<b>html bold</b>");
		expect(result).toContain("<em>bbcode italic</em>");
	});

	test("default (no htmlon): escapes raw HTML then applies BBCode", () => {
		const result = bbcodeToHtml("<b>raw</b> [b]bbcode[/b]");
		expect(result).toContain("&lt;b&gt;raw&lt;/b&gt;");
		expect(result).toContain("<strong>bbcode</strong>");
	});

	test("multiple attach tags", () => {
		const result = bbcodeToHtml("see [attach]100[/attach] and [attach]200[/attach]");
		expect(result).toContain('data-aid="100"');
		expect(result).toContain('data-aid="200"');
	});

	test("list tags", () => {
		const result = bbcodeToHtml("[list][*]item1[*]item2[/list]");
		expect(result).toContain("<ul>");
		expect(result).toContain("<li>item1");
		expect(result).toContain("<li>item2");
	});
});
