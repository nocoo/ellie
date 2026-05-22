// Unit tests for the zero-dep forum-announcement sanitizer.
//
// Requirements mapped from reviewer msg 7867cc59:
//   1. script/style/iframe/object/embed/form/base/meta/link entirely removed
//   2. all on* attrs removed
//   3. href/src only http/https/mailto + site-relative; reject javascript:,
//      data:, vbscript:, entity/case confusables
//   4. img only keeps safe src/alt/width/height (no style)
//   5. font color only safe values
//   6. <a> forced rel="nofollow noopener" target="_blank"

import { describe, expect, it } from "vitest";
import {
	ANNOUNCEMENT_MAX_BYTES,
	prepareAnnouncement,
	sanitizeForumAnnouncement,
} from "../../../src/lib/sanitizeAnnouncement";

describe("sanitizeForumAnnouncement — Req 1: dangerous tags wholesale removed", () => {
	it("removes <script> including its inner JS source", () => {
		const { html } = sanitizeForumAnnouncement('hi<script>alert("x")</script>bye');
		expect(html).toBe("hibye");
		expect(html).not.toContain("alert");
		expect(html).not.toContain("script");
	});

	it("removes <style> including CSS rules", () => {
		const { html } = sanitizeForumAnnouncement("a<style>body{color:red}</style>b");
		expect(html).toBe("ab");
		expect(html).not.toContain("color:red");
	});

	it("removes <iframe>", () => {
		const { html } = sanitizeForumAnnouncement('<iframe src="evil.com"></iframe>ok');
		expect(html).toBe("ok");
		expect(html).not.toContain("iframe");
	});

	it("removes <object>, <embed>, <form>, <base>, <meta>, <link>", () => {
		for (const tag of ["object", "embed", "form", "base", "meta", "link"]) {
			const { html } = sanitizeForumAnnouncement(`<${tag}>x</${tag}>ok`);
			expect(html).toBe("ok");
		}
	});

	it("removes <svg> and <math> (XSS surface in legacy parsers)", () => {
		expect(sanitizeForumAnnouncement("<svg><g/></svg>ok").html).toBe("ok");
		expect(sanitizeForumAnnouncement("<math><mi/></math>ok").html).toBe("ok");
	});

	it("strips HTML comments and CDATA (IE conditional-comment script smuggling)", () => {
		expect(sanitizeForumAnnouncement("a<!--[if IE]><script>x</script><![endif]-->b").html).toBe(
			"ab",
		);
		expect(sanitizeForumAnnouncement("x<![CDATA[<script>y</script>]]>z").html).toBe("xz");
	});

	it("strips doctype and processing instructions", () => {
		expect(sanitizeForumAnnouncement("<!DOCTYPE html>hi").html).toBe("hi");
		expect(sanitizeForumAnnouncement("<?xml version='1.0'?>hi").html).toBe("hi");
	});

	it("counts dropped tags in stats", () => {
		const { stats } = sanitizeForumAnnouncement("<script>x</script><iframe></iframe><div>y</div>");
		expect(stats.droppedTags.script).toBe(1);
		expect(stats.droppedTags.iframe).toBe(1);
		expect(stats.droppedTags.div).toBe(1);
	});
});

describe("sanitizeForumAnnouncement — Req 2: on* event handlers removed", () => {
	it("removes onclick / onmouseover / onerror from any tag", () => {
		const { html } = sanitizeForumAnnouncement(
			'<p onclick="x()">hi</p><a href="/x" onmouseover="y()">l</a>',
		);
		expect(html).not.toContain("onclick");
		expect(html).not.toContain("onmouseover");
		expect(html).toContain("<p>hi</p>");
	});

	it("removes onerror even on img (the classic XSS payload)", () => {
		const { html } = sanitizeForumAnnouncement('<img src="/x.png" onerror="alert(1)" alt="cat" />');
		expect(html).not.toContain("onerror");
		expect(html).not.toContain("alert");
		expect(html).toContain('src="/x.png"');
		expect(html).toContain('alt="cat"');
	});

	it("removes uppercase ONCLICK (case-insensitive name handling)", () => {
		const { html } = sanitizeForumAnnouncement('<p ONCLICK="x()">hi</p>');
		expect(html).not.toMatch(/onclick/i);
	});
});

describe("sanitizeForumAnnouncement — Req 3: URL scheme allowlist", () => {
	it("accepts http / https / mailto / site-relative", () => {
		expect(sanitizeForumAnnouncement('<a href="http://x.com">l</a>').html).toContain(
			'href="http://x.com"',
		);
		expect(sanitizeForumAnnouncement('<a href="https://x.com">l</a>').html).toContain(
			'href="https://x.com"',
		);
		expect(sanitizeForumAnnouncement('<a href="mailto:a@b.com">l</a>').html).toContain(
			'href="mailto:a@b.com"',
		);
		expect(sanitizeForumAnnouncement('<a href="/forums/306">l</a>').html).toContain(
			'href="/forums/306"',
		);
	});

	it("rejects javascript: scheme", () => {
		const { html, stats } = sanitizeForumAnnouncement('<a href="javascript:alert(1)">l</a>');
		// Anchor without href is dropped entirely (a-tag requires href).
		expect(html).not.toContain("javascript");
		expect(html).not.toContain("<a");
		expect(stats.droppedUrls).toBe(1);
	});

	it("rejects data: scheme on href and img src", () => {
		expect(
			sanitizeForumAnnouncement('<a href="data:text/html,<script>x</script>">l</a>').html,
		).not.toContain("data:");
		expect(sanitizeForumAnnouncement('<img src="data:image/png;base64,xxx" />').html).toBe("");
	});

	it("rejects vbscript:, file:, ftp:, fragment-only, protocol-relative", () => {
		for (const url of [
			"vbscript:msgbox(1)",
			"file:///etc/passwd",
			"ftp://x.com",
			"#frag",
			"//x.com",
		]) {
			const { html } = sanitizeForumAnnouncement(`<a href="${url}">l</a>`);
			expect(html).not.toContain("<a");
		}
	});

	it("decodes HTML entity confusables before scheme check", () => {
		// &#x6a;avascript: -> javascript:
		expect(
			sanitizeForumAnnouncement('<a href="&#x6a;avascript:alert(1)">l</a>').html,
		).not.toContain("<a");
		// &#106;avascript:
		expect(
			sanitizeForumAnnouncement('<a href="&#106;avascript:alert(1)">l</a>').html,
		).not.toContain("<a");
		// java&Tab;script:
		expect(
			sanitizeForumAnnouncement('<a href="java&Tab;script:alert(1)">l</a>').html,
		).not.toContain("<a");
		// java&#9;script:
		expect(sanitizeForumAnnouncement('<a href="java&#9;script:alert(1)">l</a>').html).not.toContain(
			"<a",
		);
	});

	it("rejects mixed-case Javascript:/JAVASCRIPT:", () => {
		expect(sanitizeForumAnnouncement('<a href="JaVaScRiPt:x">l</a>').html).not.toContain("<a");
		expect(sanitizeForumAnnouncement('<a href="JAVASCRIPT:x">l</a>').html).not.toContain("<a");
	});

	it("rejects control-char tunneling (NUL, tab, leading-whitespace in scheme)", () => {
		// Build the NUL-containing string in code so the source file stays
		// free of literal control characters (biome lint).
		const nulInside = `<a href="java${String.fromCharCode(0)}script:x">l</a>`;
		expect(sanitizeForumAnnouncement(nulInside).html).not.toContain("<a");
		expect(sanitizeForumAnnouncement('<a href="java\tscript:x">l</a>').html).not.toContain("<a");
		expect(sanitizeForumAnnouncement('<a href="  javascript:x">l</a>').html).not.toContain("<a");
	});

	it("rejects unschemed paths like foo.html (forces explicit absolute or /-rooted)", () => {
		expect(sanitizeForumAnnouncement('<a href="foo.html">l</a>').html).not.toContain("<a");
	});
});

describe("sanitizeForumAnnouncement — Req 4: img only safe attrs, no style", () => {
	it("keeps src/alt/width/height", () => {
		const { html } = sanitizeForumAnnouncement(
			'<img src="/x.png" alt="cat" width="100" height="50" />',
		);
		expect(html).toContain('src="/x.png"');
		expect(html).toContain('alt="cat"');
		expect(html).toContain('width="100"');
		expect(html).toContain('height="50"');
	});

	it("drops style on img", () => {
		const { html } = sanitizeForumAnnouncement(
			'<img src="/x.png" style="background:url(javascript:x)" />',
		);
		expect(html).not.toContain("style");
		expect(html).not.toContain("javascript");
	});

	it("drops class/id/data-*/aria-* on img", () => {
		const { html } = sanitizeForumAnnouncement(
			'<img src="/x.png" class="c" id="i" data-x="y" aria-label="z" />',
		);
		expect(html).not.toContain("class");
		expect(html).not.toContain('id="i"');
		expect(html).not.toContain("data-");
		expect(html).not.toContain("aria-");
	});

	it("rejects non-numeric width/height", () => {
		const { html } = sanitizeForumAnnouncement(
			'<img src="/x.png" width="100px" height="javascript:x" />',
		);
		expect(html).not.toContain("width=");
		expect(html).not.toContain("height=");
	});

	it("accepts percent-suffixed width/height", () => {
		const { html } = sanitizeForumAnnouncement('<img src="/x.png" width="50%" height="100%" />');
		expect(html).toContain('width="50%"');
		expect(html).toContain('height="100%"');
	});

	it("drops img with no src", () => {
		const { html } = sanitizeForumAnnouncement('<img alt="cat" />');
		expect(html).toBe("");
	});

	it("drops img with unsafe src (data:)", () => {
		const { html } = sanitizeForumAnnouncement('<img src="data:image/png;base64,xxx" />');
		expect(html).toBe("");
	});
});

describe("sanitizeForumAnnouncement — Req 5: font color whitelisted", () => {
	it("accepts named CSS color", () => {
		expect(sanitizeForumAnnouncement('<font color="red">x</font>').html).toContain('color="red"');
		expect(sanitizeForumAnnouncement('<font color="DarkOrange">x</font>').html).toContain(
			'color="DarkOrange"',
		);
	});

	it("accepts #rgb and #rrggbb hex", () => {
		expect(sanitizeForumAnnouncement('<font color="#fff">x</font>').html).toContain('color="#fff"');
		expect(sanitizeForumAnnouncement('<font color="#FF8040">x</font>').html).toContain(
			'color="#FF8040"',
		);
	});

	it("rejects expression(...) / url(...) / rgb(...)", () => {
		expect(
			sanitizeForumAnnouncement('<font color="expression(alert(1))">x</font>').html,
		).not.toContain("color");
		expect(
			sanitizeForumAnnouncement('<font color="url(javascript:x)">x</font>').html,
		).not.toContain("color");
		expect(sanitizeForumAnnouncement('<font color="rgb(255,0,0)">x</font>').html).not.toContain(
			"color",
		);
	});

	it("rejects malformed hex", () => {
		expect(sanitizeForumAnnouncement('<font color="#xyz">x</font>').html).not.toContain("color");
		expect(sanitizeForumAnnouncement('<font color="#ff">x</font>').html).not.toContain("color");
	});

	it("drops font size attribute (not in allowlist)", () => {
		const { html } = sanitizeForumAnnouncement('<font color="red" size="7">x</font>');
		expect(html).toContain('color="red"');
		expect(html).not.toContain("size");
	});
});

describe("sanitizeForumAnnouncement — Req 6: anchor hardening", () => {
	it("forces rel=nofollow noopener and target=_blank on every <a>", () => {
		const { html } = sanitizeForumAnnouncement('<a href="https://x.com">l</a>');
		expect(html).toContain('rel="nofollow noopener"');
		expect(html).toContain('target="_blank"');
	});

	it("overrides user-supplied rel and target (drops them, re-adds forced values)", () => {
		const { html } = sanitizeForumAnnouncement(
			'<a href="https://x.com" rel="dofollow" target="_self">l</a>',
		);
		expect(html).toContain('rel="nofollow noopener"');
		expect(html).toContain('target="_blank"');
		expect(html).not.toContain("dofollow");
		expect(html).not.toContain("_self");
		expect(html.match(/rel=/g)?.length).toBe(1);
		expect(html.match(/target=/g)?.length).toBe(1);
	});

	it("drops <a> entirely if href is unsafe", () => {
		const { html } = sanitizeForumAnnouncement('<a href="javascript:x">link</a>');
		expect(html).toBe("link");
		expect(html).not.toContain("<a");
	});
});

describe("sanitizeForumAnnouncement — control chars + text escaping", () => {
	it("strips NUL and counts it", () => {
		const input = `hello${String.fromCharCode(0)} world`;
		const { html, stats } = sanitizeForumAnnouncement(input);
		expect(html).toBe("hello world");
		expect(stats.nulRemoved).toBe(1);
	});

	it("strips other C0 controls except \\t \\n \\r", () => {
		const { html } = sanitizeForumAnnouncement("abc\td\ne\rf");
		expect(html).toBe("abc\td\ne\rf");
	});

	it("escapes < > & in text nodes", () => {
		const { html } = sanitizeForumAnnouncement("a < b && c > d");
		expect(html).toBe("a &lt; b &amp;&amp; c &gt; d");
	});

	it("escapes quotes within attr values", () => {
		const { html } = sanitizeForumAnnouncement('<a href="/x" title=\'a"b\'>l</a>');
		expect(html).toContain('title="a&quot;b"');
	});
});

describe("sanitizeForumAnnouncement — entity round-trip (no double-escape)", () => {
	// Reviewer msg 3ab6a827: legacy Discuz announcements contain
	// pre-escaped entities like `&amp;` in href and `&nbsp;` in text.
	// Re-escaping them turns `&amp;` into `&amp;amp;` (visible bug in
	// fid=306, where `forum.php?mod=forumdisplay&amp;fid=134` was
	// rendering with literal `&amp;amp;` in the URL) and `&nbsp;` into
	// `&amp;nbsp;` (literal "&nbsp;" displayed instead of NBSP).
	// The sanitizer must decode known entities once before re-escaping
	// so its output is idempotent.

	it("does not double-escape &amp; inside href query string", () => {
		const { html } = sanitizeForumAnnouncement('<a href="http://x.test/?a=1&amp;b=2">x</a>');
		expect(html).toContain('href="http://x.test/?a=1&amp;b=2"');
		expect(html).not.toContain("amp;amp;");
	});

	it("decodes &nbsp; in text to literal NBSP, not &amp;nbsp;", () => {
		const { html } = sanitizeForumAnnouncement("foo&nbsp;bar");
		// U+00A0 NBSP, not the literal six-char sequence "&nbsp;".
		expect(html).toBe("foo bar");
		expect(html).not.toContain("&nbsp;");
		expect(html).not.toContain("&amp;nbsp;");
	});

	it("decodes &amp;/&lt;/&gt;/&quot; round-trip cleanly", () => {
		// `&amp;` should become `&amp;` (decoded then re-escaped),
		// `&lt;` / `&gt;` re-escaped, `&quot;` re-escaped in attr context.
		const { html } = sanitizeForumAnnouncement("a &amp; b &lt; c &gt; d");
		expect(html).toBe("a &amp; b &lt; c &gt; d");
		// And again — running twice yields the same bytes.
		const { html: pass2 } = sanitizeForumAnnouncement(html);
		expect(pass2).toBe(html);
	});

	it("is idempotent: sanitize(sanitize(x)) === sanitize(x)", () => {
		const input = '<a href="http://x.test/?a=1&amp;b=2" title="A&amp;B">x&nbsp;y &lt;tag&gt;</a>';
		const once = sanitizeForumAnnouncement(input).html;
		const twice = sanitizeForumAnnouncement(once).html;
		expect(twice).toBe(once);
	});

	it("still blocks javascript: hiding behind &amp;#106; (double entity)", () => {
		// `&amp;#106;avascript:` decodes to `&#106;avascript:` which then
		// decodes to `javascript:` — `isSafeUrl` runs decodeEntities
		// once, which catches the first layer; the URL still fails the
		// scheme test because the second layer leaves `&#106;avascript:`
		// (not a recognized scheme). Either way the attribute is dropped.
		const { html } = sanitizeForumAnnouncement('<a href="&amp;#106;avascript:alert(1)">x</a>');
		expect(html).not.toContain("javascript");
		expect(html).not.toContain("alert");
	});

	it("still blocks javascript: hiding behind numeric entity", () => {
		const { html } = sanitizeForumAnnouncement('<a href="&#106;avascript:alert(1)">x</a>');
		expect(html).not.toContain("javascript");
		expect(html).not.toContain("alert");
	});

	it("does not let entity-encoded `<` smuggle a tag through text", () => {
		// Decoding entities in text could in principle re-introduce a `<`
		// that then gets re-escaped — but it must NOT be parsed as a tag.
		const { html } = sanitizeForumAnnouncement("foo &lt;script&gt;bar");
		expect(html).toBe("foo &lt;script&gt;bar");
		expect(html).not.toMatch(/<script/i);
	});
});

describe("sanitizeForumAnnouncement — quote-aware tag boundary", () => {
	it('keeps title containing `>` intact (anchor: title="a>b")', () => {
		const { html } = sanitizeForumAnnouncement('<a href="https://x.com" title="a>b">x</a>');
		// Both attrs preserved, no leakage of attr text into body.
		expect(html).toContain('href="https://x.com"');
		expect(html).toContain('title="a&gt;b"');
		expect(html).toContain(">x</a>");
		// No stray quote/text escaped into output as content.
		expect(html).not.toContain("b&quot;");
		expect(html).not.toMatch(/b"&gt;/);
	});

	it("keeps img src/alt containing `>` intact", () => {
		const { html } = sanitizeForumAnnouncement(
			'<img src="https://x.com/a>b.png" alt="x>y" width="10">',
		);
		expect(html).toContain('src="https://x.com/a&gt;b.png"');
		expect(html).toContain('alt="x&gt;y"');
		expect(html).toContain('width="10"');
		// Tag terminates cleanly; no escaped `>` leaks out as body text
		// after the tag closes.
		expect(html).toBe('<img src="https://x.com/a&gt;b.png" alt="x&gt;y" width="10" />');
	});
});

describe("sanitizeForumAnnouncement — structure", () => {
	it("preserves allowed structural tags p/br/span/ul/ol/li", () => {
		const input = "<p>hi<br/></p><ul><li>a</li></ul><ol><li>b</li></ol><span>c</span>";
		const { html } = sanitizeForumAnnouncement(input);
		expect(html).toContain("<p>");
		expect(html).toContain("<br />");
		expect(html).toContain("<ul>");
		expect(html).toContain("<li>a</li>");
		expect(html).toContain("<ol>");
		expect(html).toContain("<span>c</span>");
	});

	it("preserves strong/em/b/i/u inline tags", () => {
		const { html } = sanitizeForumAnnouncement(
			"<strong>a</strong><em>b</em><b>c</b><i>d</i><u>e</u>",
		);
		expect(html).toBe("<strong>a</strong><em>b</em><b>c</b><i>d</i><u>e</u>");
	});

	it("drops unknown structural tags but keeps text inside", () => {
		const { html } = sanitizeForumAnnouncement("<div>hello</div>");
		expect(html).toBe("hello");
	});

	it("idempotent: sanitize(sanitize(x)) === sanitize(x)", () => {
		const inputs = [
			'<p>Welcome <a href="/f/306">Jiading</a></p>',
			'<script>x</script><img src="/x.png" />',
			'<font color="red">hot</font>',
		];
		for (const inp of inputs) {
			const once = sanitizeForumAnnouncement(inp).html;
			const twice = sanitizeForumAnnouncement(once).html;
			expect(twice).toBe(once);
		}
	});

	it("preserves Chinese text", () => {
		const { html } = sanitizeForumAnnouncement(
			'<p>嘉定新风欢迎你，嘉定妖风也醉人 || 座位虽少 <a href="/r/x">取之有道</a></p>',
		);
		expect(html).toContain("嘉定新风欢迎你");
		expect(html).toContain('href="/r/x"');
		expect(html).toContain("取之有道");
	});

	it("real-world legacy fid=306 style payload survives intact", () => {
		const input =
			'<p><font color="#FF8040">嘉定新风欢迎你</font>，嘉定妖风也醉人 || 座位虽少 <strong>取之有道</strong>' +
			' 本版对<a href="https://example.com/rules" rel="nofollow">谴责占座行为</a>的人身攻击不予制止</p>';
		const { html } = sanitizeForumAnnouncement(input);
		expect(html).toContain("嘉定新风欢迎你");
		expect(html).toContain('color="#FF8040"');
		expect(html).toContain("<strong>取之有道</strong>");
		expect(html).toContain('href="https://example.com/rules"');
		expect(html).toContain('rel="nofollow noopener"');
		expect(html).toContain('target="_blank"');
	});
});

describe("prepareAnnouncement — validation", () => {
	it("INVALID_TYPE for non-string", () => {
		expect(prepareAnnouncement(null)).toEqual({ ok: false, code: "INVALID_TYPE" });
		expect(prepareAnnouncement(undefined)).toEqual({ ok: false, code: "INVALID_TYPE" });
		expect(prepareAnnouncement(123)).toEqual({ ok: false, code: "INVALID_TYPE" });
		expect(prepareAnnouncement({})).toEqual({ ok: false, code: "INVALID_TYPE" });
	});

	it("empty string accepted (clears announcement)", () => {
		const r = prepareAnnouncement("");
		expect(r.ok).toBe(true);
		expect(r.html).toBe("");
	});

	it("TOO_LONG when sanitized output exceeds 4 KiB", () => {
		const huge = "a".repeat(ANNOUNCEMENT_MAX_BYTES + 1);
		expect(prepareAnnouncement(huge)).toEqual(
			expect.objectContaining({ ok: false, code: "TOO_LONG" }),
		);
	});

	it("oversized input that sanitizes back into budget is accepted", () => {
		// 5 KiB of <script> noise sanitizes to empty.
		const noise = `<script>${"x".repeat(5000)}</script>real content`;
		const r = prepareAnnouncement(noise);
		expect(r.ok).toBe(true);
		expect(r.html).toBe("real content");
	});

	it("4 KiB cap enforced on POST-sanitize output, UTF-8 byte length", () => {
		// 1500 chinese chars ~ 4500 bytes UTF-8 — should overflow even though
		// char-count is well under 4096.
		const overflow = "中".repeat(1500);
		expect(prepareAnnouncement(overflow)).toEqual(
			expect.objectContaining({ ok: false, code: "TOO_LONG" }),
		);
	});

	it("returns sanitize stats alongside html on success", () => {
		const r = prepareAnnouncement("<p>hi</p><script>x</script>");
		expect(r.ok).toBe(true);
		expect(r.stats?.droppedTags.script).toBe(1);
	});
});
