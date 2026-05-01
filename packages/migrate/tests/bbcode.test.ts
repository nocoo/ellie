import { describe, expect, test } from "vitest";
import { bbcodeToHtml, escapeHtml, sanitizeHtml, sanitizeUrl } from "../src/transform/bbcode";

// ─── escapeHtml ──────────────────────────────────────────────────────────────

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

// ─── sanitizeUrl ─────────────────────────────────────────────────────────────

describe("sanitizeUrl", () => {
	test("allows https", () => {
		expect(sanitizeUrl("https://example.com")).toBe("https://example.com");
	});

	test("allows http", () => {
		expect(sanitizeUrl("http://example.com")).toBe("http://example.com");
	});

	test("allows ftp", () => {
		expect(sanitizeUrl("ftp://files.example.com/f.zip")).toBe("ftp://files.example.com/f.zip");
	});

	test("allows mailto", () => {
		expect(sanitizeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
	});

	test("blocks javascript:", () => {
		expect(sanitizeUrl("javascript:alert(1)")).toBe("");
	});

	test("blocks JavaScript: (case insensitive)", () => {
		expect(sanitizeUrl("JavaScript:void(0)")).toBe("");
	});

	test("blocks data:", () => {
		expect(sanitizeUrl("data:text/html,<h1>XSS</h1>")).toBe("");
	});

	test("blocks vbscript:", () => {
		expect(sanitizeUrl("vbscript:msgbox('hi')")).toBe("");
	});

	test("allows relative paths", () => {
		expect(sanitizeUrl("/images/pic.jpg")).toBe("/images/pic.jpg");
	});

	test("allows dot-relative paths", () => {
		expect(sanitizeUrl("./pic.jpg")).toBe("./pic.jpg");
	});

	test("allows hash anchors", () => {
		expect(sanitizeUrl("#section")).toBe("#section");
	});

	test("allows bare path (no protocol)", () => {
		expect(sanitizeUrl("images/pic.jpg")).toBe("images/pic.jpg");
	});

	test("empty string returns empty", () => {
		expect(sanitizeUrl("")).toBe("");
	});

	test("trims whitespace", () => {
		expect(sanitizeUrl("  https://example.com  ")).toBe("https://example.com");
	});
});

// ─── sanitizeHtml ────────────────────────────────────────────────────────────

describe("sanitizeHtml", () => {
	test("strips <script> blocks", () => {
		expect(sanitizeHtml('<script>alert("xss")</script>safe')).toBe("safe");
	});

	test("strips <script> with attributes", () => {
		expect(sanitizeHtml('<script type="text/javascript">evil()</script>')).toBe("");
	});

	test("strips <style> blocks", () => {
		expect(sanitizeHtml("<style>body{display:none}</style>visible")).toBe("visible");
	});

	test("strips event handlers (onclick)", () => {
		expect(sanitizeHtml('<div onclick="evil()">text</div>')).toBe("<div>text</div>");
	});

	test("strips event handlers (onerror)", () => {
		expect(sanitizeHtml('<img onerror="alert(1)" src="x">')).toBe('<img src="x">');
	});

	test("strips event handlers with single quotes", () => {
		expect(sanitizeHtml("<div onmouseover='evil()'>text</div>")).toBe("<div>text</div>");
	});

	test("strips javascript: in href", () => {
		expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('<a href="">click</a>');
	});

	test("strips javascript: in src", () => {
		expect(sanitizeHtml('<iframe src="javascript:evil()">')).toBe("");
	});

	test("strips iframe tags", () => {
		expect(sanitizeHtml('<iframe src="evil.html"></iframe>safe')).toBe("safe");
	});

	test("strips embed tags", () => {
		expect(sanitizeHtml('<embed src="evil.swf">safe')).toBe("safe");
	});

	test("strips object tags", () => {
		expect(sanitizeHtml("<object><param></object>safe")).toBe("<param>safe");
	});

	test("strips form tags", () => {
		expect(sanitizeHtml("<form><input></form>")).toBe("<input>");
	});

	test("strips base/meta/link tags", () => {
		expect(sanitizeHtml('<base href="evil"><meta><link rel="stylesheet">safe')).toBe("safe");
	});

	test("preserves safe HTML", () => {
		const safe = '<div class="post"><p>Hello <b>world</b></p></div>';
		expect(sanitizeHtml(safe)).toBe(safe);
	});
});

// ─── bbcodeToHtml ────────────────────────────────────────────────────────────

describe("bbcodeToHtml", () => {
	// Basic functionality
	test("empty string", () => {
		expect(bbcodeToHtml("")).toBe("");
	});

	test("plain text (no BBCode)", () => {
		expect(bbcodeToHtml("Hello world")).toBe("Hello world");
	});

	// Simple tags
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

	// URL tags with security
	test("[url=href]text[/url] with https", () => {
		expect(bbcodeToHtml("[url=https://example.com]click[/url]")).toBe(
			'<a href="https://example.com">click</a>',
		);
	});

	test("[url]href[/url] with https", () => {
		expect(bbcodeToHtml("[url]https://example.com[/url]")).toBe(
			'<a href="https://example.com">https://example.com</a>',
		);
	});

	test("[url=javascript:...]text[/url] blocked", () => {
		const result = bbcodeToHtml("[url=javascript:alert(1)]click[/url]");
		expect(result).not.toContain("javascript:");
		expect(result).toContain("click"); // Content preserved
		expect(result).not.toContain("<a");
	});

	test("[url]javascript:...[/url] blocked — no link generated", () => {
		const result = bbcodeToHtml("[url]javascript:alert(1)[/url]");
		expect(result).not.toContain("<a"); // No clickable link
		expect(result).not.toContain("href"); // No href attribute
	});

	test("[url=data:...]text[/url] blocked", () => {
		const result = bbcodeToHtml("[url=data:text/html,<h1>xss</h1>]click[/url]");
		expect(result).not.toContain("data:");
		expect(result).toContain("click");
	});

	// Image tags with security
	test("[img]src[/img] with https", () => {
		expect(bbcodeToHtml("[img]https://example.com/pic.jpg[/img]")).toBe(
			'<img src="https://example.com/pic.jpg">',
		);
	});

	test("[img]javascript:...[/img] blocked", () => {
		const result = bbcodeToHtml("[img]javascript:alert(1)[/img]");
		expect(result).not.toContain("javascript:");
		expect(result).not.toContain("<img");
	});

	// Color tags with validation
	test("[color=red]text[/color] valid named color", () => {
		expect(bbcodeToHtml("[color=red]red text[/color]")).toBe(
			'<span style="color:red">red text</span>',
		);
	});

	test("[color=#FF0000]text[/color] valid hex", () => {
		expect(bbcodeToHtml("[color=#FF0000]colored[/color]")).toBe(
			'<span style="color:#FF0000">colored</span>',
		);
	});

	test("[color=#abc]text[/color] short hex", () => {
		expect(bbcodeToHtml("[color=#abc]text[/color]")).toBe('<span style="color:#abc">text</span>');
	});

	test("[color=rgb(255,0,0)]text[/color] valid rgb", () => {
		expect(bbcodeToHtml("[color=rgb(255,0,0)]text[/color]")).toBe(
			'<span style="color:rgb(255,0,0)">text</span>',
		);
	});

	test("[color=expression(evil)]text[/color] CSS injection blocked", () => {
		const result = bbcodeToHtml("[color=expression(evil)]text[/color]");
		expect(result).not.toContain("expression");
		expect(result).toBe("text"); // Content preserved, tag stripped
	});

	test("[color=red;background:url(evil)]text[/color] injection blocked", () => {
		const result = bbcodeToHtml("[color=red;background:url(evil)]text[/color]");
		expect(result).not.toContain("background");
		expect(result).toBe("text");
	});

	// Size tags
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

	// Align tags with validation
	test("[align=center]text[/align] valid", () => {
		expect(bbcodeToHtml("[align=center]centered[/align]")).toBe(
			'<div style="text-align:center">centered</div>',
		);
	});

	test("[align=left]text[/align] valid", () => {
		expect(bbcodeToHtml("[align=left]left[/align]")).toBe(
			'<div style="text-align:left">left</div>',
		);
	});

	test("[align=right]text[/align] valid", () => {
		expect(bbcodeToHtml("[align=right]right[/align]")).toBe(
			'<div style="text-align:right">right</div>',
		);
	});

	test("[align=justify]text[/align] valid", () => {
		expect(bbcodeToHtml("[align=justify]justified[/align]")).toBe(
			'<div style="text-align:justify">justified</div>',
		);
	});

	test("[align=expression(evil)]text[/align] injection blocked", () => {
		const result = bbcodeToHtml("[align=expression(evil)]text[/align]");
		expect(result).not.toContain("expression");
		expect(result).toBe("text");
	});

	// Attach
	test("[attach]aid[/attach] placeholder", () => {
		expect(bbcodeToHtml("[attach]12345[/attach]")).toBe(
			'<attachment data-aid="12345"></attachment>',
		);
	});

	// Nesting
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

	// Flags
	test("bbcodeoff: treats content as plain text", () => {
		const result = bbcodeToHtml("[b]not bold[/b]", { bbcodeoff: true });
		expect(result).toBe("[b]not bold[/b]");
		expect(result).not.toContain("<strong>");
	});

	test("bbcodeoff: escapes HTML in content", () => {
		const result = bbcodeToHtml("<script>alert(1)</script>", { bbcodeoff: true });
		expect(result).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("htmlon: preserves safe raw HTML + BBCode", () => {
		const result = bbcodeToHtml("<b>html bold</b> [i]bbcode italic[/i]", { htmlon: true });
		expect(result).toContain("<b>html bold</b>");
		expect(result).toContain("<em>bbcode italic</em>");
	});

	test("htmlon: strips dangerous HTML", () => {
		const result = bbcodeToHtml("<script>evil()</script><p>safe</p> [b]ok[/b]", {
			htmlon: true,
		});
		expect(result).not.toContain("<script>");
		expect(result).toContain("<p>safe</p>");
		expect(result).toContain("<strong>ok</strong>");
	});

	test("htmlon: strips event handlers", () => {
		const result = bbcodeToHtml('<div onclick="evil()">text</div>', { htmlon: true });
		expect(result).not.toContain("onclick");
		expect(result).toContain("text");
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

	// List tags
	test("[list] unordered list", () => {
		const result = bbcodeToHtml("[list][*]item1[*]item2[/list]");
		expect(result).toContain("<ul>");
		expect(result).toContain("</ul>");
		expect(result).toContain("<li>item1");
		expect(result).toContain("<li>item2");
	});

	test("[list=1] ordered list closes with </ol>", () => {
		const result = bbcodeToHtml("[list=1][*]first[*]second[/list]");
		expect(result).toContain("<ol>");
		expect(result).toContain("</ol>");
		expect(result).not.toContain("</ul>");
		expect(result).toContain("<li>first");
	});

	test("[list] then [list=1] nested — correct closing tags", () => {
		const result = bbcodeToHtml("[list][*]outer[list=1][*]inner[/list][/list]");
		expect(result).toContain("<ul>");
		expect(result).toContain("<ol>");
		expect(result).toContain("</ol>");
		expect(result).toContain("</ul>");
	});

	test("multiple separate lists", () => {
		const result = bbcodeToHtml("[list][*]a[/list] [list=1][*]b[/list]");
		expect(result).toContain("<ul>");
		expect(result).toContain("</ul>");
		expect(result).toContain("<ol>");
		expect(result).toContain("</ol>");
	});
});
