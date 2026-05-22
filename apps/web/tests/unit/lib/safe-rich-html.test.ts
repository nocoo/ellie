// Tests for the web-side rich-HTML sanitizer used in the announcement
// preview + display surfaces. Mirrors the Worker allowlist in
// `apps/worker/src/lib/sanitizeAnnouncement.ts`; the Worker is the
// authoritative security boundary, this file exists for live preview UX
// plus defense-in-depth on the public render.

import { sanitizeRichHtml } from "@/lib/safe-rich-html";
import { describe, expect, test } from "vitest";

describe("sanitizeRichHtml — basic shape", () => {
	test("returns empty string for null / undefined / empty", () => {
		expect(sanitizeRichHtml(null)).toBe("");
		expect(sanitizeRichHtml(undefined)).toBe("");
		expect(sanitizeRichHtml("")).toBe("");
	});

	test("passes plain text through unchanged", () => {
		expect(sanitizeRichHtml("Hello world")).toBe("Hello world");
	});

	test("escapes raw < that doesn't start a tag as &lt;", () => {
		expect(sanitizeRichHtml("a < b")).toBe("a &lt; b");
	});
});

describe("sanitizeRichHtml — allowlist (announcement-specific)", () => {
	test("keeps <p>, <br>, <ul>, <ol>, <li>, <span>", () => {
		const html = sanitizeRichHtml("<p>hi</p><ul><li>a</li><li>b</li></ul><br><span>x</span>");
		expect(html).toBe("<p>hi</p><ul><li>a</li><li>b</li></ul><br /><span>x</span>");
	});

	test("keeps inline emphasis tags", () => {
		expect(sanitizeRichHtml("<strong>s</strong><em>e</em><b>b</b><i>i</i><u>u</u>")).toBe(
			"<strong>s</strong><em>e</em><b>b</b><i>i</i><u>u</u>",
		);
	});

	test("keeps <font color> with named and hex colors", () => {
		expect(sanitizeRichHtml('<font color="red">x</font>')).toBe('<font color="red">x</font>');
		expect(sanitizeRichHtml('<font color="#ff0000">x</font>')).toBe(
			'<font color="#ff0000">x</font>',
		);
	});

	test("rejects unsafe color values", () => {
		const result = sanitizeRichHtml('<font color="javascript:alert(1)">x</font>');
		expect(result).toBe("<font>x</font>");
	});

	test("keeps <img> with src / alt / width / height", () => {
		const html = sanitizeRichHtml(
			'<img src="https://example.com/a.png" alt="logo" width="100" height="50">',
		);
		expect(html).toBe('<img src="https://example.com/a.png" alt="logo" width="100" height="50" />');
	});

	test("drops <img> with no src", () => {
		expect(sanitizeRichHtml('<img alt="x">')).toBe("");
	});

	test("drops <img> with javascript: src", () => {
		expect(sanitizeRichHtml('<img src="javascript:alert(1)">')).toBe("");
	});

	test("drops <img> with data: src", () => {
		expect(sanitizeRichHtml('<img src="data:image/svg+xml,<svg/onload=alert(1)>">')).toBe("");
	});

	test("rejects protocol-relative URLs (//evil.com)", () => {
		// href is rejected → finalizeAnchorOrImg drops the open tag, so no
		// element is emitted. Inner text still flows out as plain content.
		const html = sanitizeRichHtml('<a href="//evil.com">x</a>');
		expect(html).not.toContain("<a");
		expect(html).not.toContain("evil.com");
	});

	test("keeps site-relative URLs", () => {
		const html = sanitizeRichHtml('<a href="/forums/1">x</a>');
		expect(html).toContain('href="/forums/1"');
		expect(html).toContain('rel="nofollow noopener"');
		expect(html).toContain('target="_blank"');
	});

	test("keeps mailto: links", () => {
		const html = sanitizeRichHtml('<a href="mailto:hi@example.com">mail</a>');
		expect(html).toContain('href="mailto:hi@example.com"');
	});

	test("drops <a> with no href", () => {
		expect(sanitizeRichHtml("<a>nope</a>")).toBe("nope");
	});
});

describe("sanitizeRichHtml — drop / strip dangerous content", () => {
	test("drops <script> AND its body", () => {
		expect(sanitizeRichHtml("<script>alert(1)</script>after")).toBe("after");
	});

	test("drops <style> AND its body", () => {
		expect(sanitizeRichHtml("<style>body{color:red}</style>kept")).toBe("kept");
	});

	test("drops <iframe>, <object>, <embed>", () => {
		expect(sanitizeRichHtml('<iframe src="evil"></iframe>')).toBe("");
		expect(sanitizeRichHtml('<object data="x"></object>')).toBe("");
		expect(sanitizeRichHtml('<embed src="x">')).toBe("");
	});

	test("strips event handlers like onclick / onerror", () => {
		const html = sanitizeRichHtml('<a href="/" onclick="alert(1)">x</a>');
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("alert");
	});

	test("strips style / class / id attributes", () => {
		const html = sanitizeRichHtml('<span style="x" class="y" id="z">t</span>');
		expect(html).toBe("<span>t</span>");
	});

	test("strips namespaced (xmlns / xlink) attributes", () => {
		const html = sanitizeRichHtml('<a href="/" xmlns:xlink="http://evil">x</a>');
		expect(html).not.toContain("xmlns");
		expect(html).not.toContain("xlink");
	});

	test("strips HTML comments and CDATA / doctype / processing instructions", () => {
		expect(sanitizeRichHtml("<!-- secret --><p>x</p>")).toBe("<p>x</p>");
		expect(sanitizeRichHtml("<![CDATA[evil]]><p>x</p>")).toBe("<p>x</p>");
		expect(sanitizeRichHtml("<!DOCTYPE html><p>x</p>")).toBe("<p>x</p>");
	});
});

describe("sanitizeRichHtml — URL entity-confusable bypasses", () => {
	test("blocks &#106;avascript: in href via entity decoding", () => {
		const html = sanitizeRichHtml('<a href="&#106;avascript:alert(1)">x</a>');
		expect(html).not.toContain("javascript");
		expect(html).not.toContain("alert");
	});

	test("blocks tab-padded javascript: URL", () => {
		const html = sanitizeRichHtml('<a href="java\tscript:alert(1)">x</a>');
		expect(html).not.toContain("script");
	});

	test("blocks NUL-padded javascript: URL", () => {
		const nul = String.fromCharCode(0);
		const html = sanitizeRichHtml(`<a href="java${nul}script:alert(1)">x</a>`);
		expect(html).not.toContain("script");
	});
});

describe("sanitizeRichHtml — quote-aware tag boundary", () => {
	// Regression: a bare `>` inside a quoted attribute value (e.g.
	// `title="a>b"`) must NOT terminate the tag. Mirror of the Worker fix
	// at sanitizeAnnouncement.ts:findTagEnd (commit ece753f4 / reviewer
	// msg 8d9454a9).

	test("anchor title containing > stays in the same tag", () => {
		const html = sanitizeRichHtml('<a href="/x" title="a>b">link</a>');
		expect(html).toBe(
			'<a href="/x" title="a&gt;b" rel="nofollow noopener" target="_blank">link</a>',
		);
	});

	test("img with > inside src and alt is parsed as a single tag", () => {
		const html = sanitizeRichHtml('<img src="https://example.com/a>b.png" alt="x>y" width="10">');
		expect(html).toBe('<img src="https://example.com/a&gt;b.png" alt="x&gt;y" width="10" />');
	});

	test("single-quoted attribute values also protect > from terminating", () => {
		const html = sanitizeRichHtml("<a href='/x' title='a>b'>link</a>");
		expect(html).toContain('title="a&gt;b"');
		// And the link text must be `link`, not `b">link`.
		expect(html).toContain(">link</a>");
	});
});

describe("sanitizeRichHtml — attribute output escaping", () => {
	test("escapes double quotes in single-quoted source attribute", () => {
		const html = sanitizeRichHtml(`<a href="/" title='x" onclick="alert(1)'>x</a>`);
		expect(html).not.toMatch(/"\s+onclick\s*=/);
		expect(html).toContain("&quot;");
	});

	test("escapes & and < in attribute values", () => {
		const html = sanitizeRichHtml(`<a href="/" title='a&b<c'>x</a>`);
		expect(html).toContain('title="a&amp;b&lt;c"');
	});
});

describe("sanitizeRichHtml — width / height validation", () => {
	test("accepts plain digits", () => {
		expect(
			sanitizeRichHtml('<img src="https://example.com/a.png" width="200" height="100">'),
		).toContain('width="200"');
	});

	test("accepts percentage", () => {
		expect(sanitizeRichHtml('<img src="https://example.com/a.png" width="50%">')).toContain(
			'width="50%"',
		);
	});

	test("rejects non-numeric width", () => {
		const html = sanitizeRichHtml(
			'<img src="https://example.com/a.png" width="100px" height="auto">',
		);
		expect(html).not.toContain("100px");
		expect(html).not.toContain("auto");
	});
});

describe("sanitizeRichHtml — stack closure", () => {
	test("auto-closes unbalanced open tags", () => {
		expect(sanitizeRichHtml("<p>hi")).toBe("<p>hi</p>");
		expect(sanitizeRichHtml("<ul><li>a")).toBe("<ul><li>a</li></ul>");
	});

	test("ignores stray closing tags", () => {
		expect(sanitizeRichHtml("</p>text</span>")).toBe("text");
	});
});

describe("sanitizeRichHtml — entity round-trip (no double-escape)", () => {
	// Mirror of `apps/worker/tests/unit/lib/sanitizeAnnouncement.test.ts`
	// "entity round-trip" suite. The Worker sanitizes on the write path,
	// the Web sanitizer is preview + defense-in-depth — both must produce
	// identical output for the legacy fid=306 case (reviewer msg 3ab6a827).

	test("does not double-escape &amp; inside href query string", () => {
		const html = sanitizeRichHtml('<a href="http://x.test/?a=1&amp;b=2">x</a>');
		expect(html).toContain('href="http://x.test/?a=1&amp;b=2"');
		expect(html).not.toContain("amp;amp;");
	});

	test("decodes &nbsp; in text to literal NBSP, not &amp;nbsp;", () => {
		const html = sanitizeRichHtml("foo&nbsp;bar");
		const NBSP = String.fromCharCode(0xa0);
		expect(html).toBe(`foo${NBSP}bar`);
		expect(html).not.toContain("&nbsp;");
		expect(html).not.toContain("&amp;nbsp;");
	});

	test("decodes &amp;/&lt;/&gt;/&quot; round-trip cleanly", () => {
		const html = sanitizeRichHtml("a &amp; b &lt; c &gt; d");
		expect(html).toBe("a &amp; b &lt; c &gt; d");
		expect(sanitizeRichHtml(html)).toBe(html);
	});

	test("is idempotent: sanitize(sanitize(x)) === sanitize(x)", () => {
		const input = '<a href="http://x.test/?a=1&amp;b=2" title="A&amp;B">x&nbsp;y &lt;tag&gt;</a>';
		const once = sanitizeRichHtml(input);
		const twice = sanitizeRichHtml(once);
		expect(twice).toBe(once);
	});

	test("still blocks javascript: hiding behind &amp;#106; (double entity)", () => {
		const html = sanitizeRichHtml('<a href="&amp;#106;avascript:alert(1)">x</a>');
		expect(html).not.toContain("javascript");
		expect(html).not.toContain("alert");
	});

	test("still blocks javascript: hiding behind numeric entity", () => {
		const html = sanitizeRichHtml('<a href="&#106;avascript:alert(1)">x</a>');
		expect(html).not.toContain("javascript");
		expect(html).not.toContain("alert");
	});

	test("does not let entity-encoded `<` smuggle a tag through text", () => {
		const html = sanitizeRichHtml("foo &lt;script&gt;bar");
		expect(html).toBe("foo &lt;script&gt;bar");
		expect(html).not.toMatch(/<script/i);
	});
});
