import {
	cleanupCETagParser,
	cleanupLegacyBBCode,
	filterContent,
	rewriteLegacyUrls,
	transformEditNotices,
} from "@/lib/content-filter";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// transformEditNotices
// ---------------------------------------------------------------------------

describe("transformEditNotices", () => {
	it("transforms [i=s] edit notice with </em> closing", () => {
		const input = "[i=s] 本帖最后由 张三 于 2024-5-18 14:30 编辑 </em>\n\n正文内容";
		const result = transformEditNotices(input);
		expect(result).toContain('class="dz-edit-notice"');
		expect(result).toContain("本帖最后由 张三 于 2024-5-18 14:30 编辑");
		expect(result).not.toContain("[i=s]");
		expect(result).not.toContain("</em>");
		expect(result).toContain("正文内容");
	});

	it("transforms [i=s] edit notice with [/i] closing", () => {
		const input = "[i=s] 本帖最后由 李四 于 2023-12-1 09:15 编辑 [/i]\n\n内容";
		const result = transformEditNotices(input);
		expect(result).toContain('class="dz-edit-notice"');
		expect(result).toContain("本帖最后由 李四 于 2023-12-1 09:15 编辑");
		expect(result).not.toContain("[i=s]");
		expect(result).not.toContain("[/i]");
	});

	it("handles username with English characters", () => {
		const input = "[i=s] 本帖最后由 VIDEOJEFF 于 2025-4-24 11:53 编辑 </em>";
		const result = transformEditNotices(input);
		expect(result).toContain("VIDEOJEFF");
		expect(result).toContain("2025-4-24 11:53");
	});

	it("escapes HTML in username to prevent XSS", () => {
		const input = "[i=s] 本帖最后由 <script>alert(1)</script> 于 2024-1-1 00:00 编辑 </em>";
		const result = transformEditNotices(input);
		expect(result).not.toContain("<script>");
		expect(result).toContain("&lt;script&gt;");
	});

	it("leaves non-matching content unchanged", () => {
		const input = "普通帖子内容，没有编辑记录";
		const result = transformEditNotices(input);
		expect(result).toBe(input);
	});
});

// ---------------------------------------------------------------------------
// cleanupLegacyBBCode
// ---------------------------------------------------------------------------

describe("cleanupLegacyBBCode", () => {
	describe("[fly] tag", () => {
		it("strips [fly] tags and keeps content", () => {
			const input = "[fly]打分呀！投票呀！[/fly]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("打分呀！投票呀！");
		});

		it("handles multiline [fly] content", () => {
			const input = "[fly]第一行\n第二行[/fly]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("第一行\n第二行");
		});
	});

	describe("[move] tag", () => {
		it("strips [move] tags and keeps content", () => {
			const input = "[move]滚动文字[/move]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("滚动文字");
		});
	});

	describe("[glow] tag", () => {
		it("strips [glow] tags and keeps content", () => {
			const input = "[glow=200,red,2]发光文字[/glow]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("发光文字");
		});
	});

	describe("[shadow] tag", () => {
		it("strips [shadow] tags and keeps content", () => {
			const input = "[shadow=200,blue,left]阴影文字[/shadow]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("阴影文字");
		});
	});

	describe("[align] tag", () => {
		it("converts [align=center] to div with style", () => {
			const input = "[align=center]居中文字[/align]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('<div style="text-align:center">居中文字</div>');
		});

		it("converts [align=right] to div with style", () => {
			const input = "[align=right]右对齐[/align]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('<div style="text-align:right">右对齐</div>');
		});

		it("converts [align=left] to div with style", () => {
			const input = "[align=left]左对齐[/align]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('<div style="text-align:left">左对齐</div>');
		});

		it("handles uppercase ALIGN", () => {
			const input = "[ALIGN=CENTER]居中[/ALIGN]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('<div style="text-align:center">居中</div>');
		});
	});

	describe("[font] tag", () => {
		it("strips [font] tags and keeps content", () => {
			const input = "[font=宋体]宋体文字[/font]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("宋体文字");
		});
	});

	describe("[backcolor] tag", () => {
		it("strips [backcolor] tags and keeps content", () => {
			const input = "[backcolor=yellow]高亮文字[/backcolor]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("高亮文字");
		});
	});

	describe("[free] tag", () => {
		it("strips [free] tags and keeps content", () => {
			const input = "[free]免费内容[/free]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("免费内容");
		});
	});

	describe("[hide] tag", () => {
		it("converts [hide] to placeholder", () => {
			const input = "[hide]隐藏内容[/hide]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toContain('class="dz-hidden-content"');
			expect(result).toContain("[隐藏内容]");
			// The hidden content should be replaced, not exposed
			expect(result).not.toContain("[hide]");
		});

		it("converts [hide=N] to placeholder with credit info", () => {
			const input = "[hide=100]需要积分才能看的内容[/hide]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toContain('class="dz-hidden-content"');
			expect(result).toContain("[需要积分查看的隐藏内容]");
		});
	});

	describe("[p] paragraph tag", () => {
		it("strips [p] tags and keeps content", () => {
			const input = "[p=30, 2, left]段落内容[/p]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("段落内容");
		});
	});

	describe("[float] tag", () => {
		it("converts [float=left] to div with style", () => {
			const input = "[float=left]左浮动内容[/float]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('<div style="float:left">左浮动内容</div>');
		});

		it("converts [float=right] to div with style", () => {
			const input = "[float=right]右浮动内容[/float]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('<div style="float:right">右浮动内容</div>');
		});
	});

	describe("orphan tags cleanup", () => {
		it("removes orphan [i=s] tags", () => {
			const input = "[i=s] 一些内容";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("一些内容");
		});

		it("removes orphan </em> only after edit text", () => {
			const input = "编辑 </em> 更多内容";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("编辑 更多内容");
		});

		it("preserves valid </em> HTML tags", () => {
			const input = "<em>斜体</em>正常文本";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe("<em>斜体</em>正常文本");
		});
	});

	describe("combined tags", () => {
		it("handles multiple BBCode tags in one content", () => {
			const input = "[fly]飞行[/fly]和[move]滚动[/move]和[align=center]居中[/align]";
			const result = cleanupLegacyBBCode(input);
			expect(result).toBe('飞行和滚动和<div style="text-align:center">居中</div>');
		});
	});
});

// ---------------------------------------------------------------------------
// cleanupCETagParser
// ---------------------------------------------------------------------------

describe("cleanupCETagParser", () => {
	it("removes CETagParser color comments with font tag", () => {
		const input =
			"&lt;!-- CETagParser ~color=#9932CC\n&lt;font color=&quot;#9932CC&quot;&gt;文字内容";
		const result = cleanupCETagParser(input);
		expect(result).toBe("文字内容");
	});

	it("removes CETagParser color close comments with closing font", () => {
		const input = "内容&lt;!-- CETagParser ~/color\n&lt;/font&gt;";
		const result = cleanupCETagParser(input);
		expect(result).toBe("内容");
	});

	it("removes CETagParser quote comments", () => {
		const input = "&lt;!-- CETagParser ~quote&gt;引用&lt;!-- CETagParser ~/quote&gt;";
		const result = cleanupCETagParser(input);
		expect(result).toBe("引用");
	});

	it("removes generic CETagParser comments", () => {
		const input = "&lt;!-- CETagParser ~url&gt;链接";
		const result = cleanupCETagParser(input);
		expect(result).toBe("链接");
	});

	it("handles CRLF line endings", () => {
		const input =
			"&lt;!-- CETagParser ~color=#9932CC\r\n&lt;font color=&quot;#9932CC&quot;&gt;紫色";
		const result = cleanupCETagParser(input);
		expect(result).toBe("紫色");
	});
});

// ---------------------------------------------------------------------------
// rewriteLegacyUrls
// ---------------------------------------------------------------------------

describe("rewriteLegacyUrls", () => {
	it("rewrites http://bbs.tongji.net/images/smiles/ to CDN", () => {
		const input = '<img src="http://bbs.tongji.net/images/smiles/tounge_smile.gif">';
		const result = rewriteLegacyUrls(input);
		expect(result).toBe('<img src="https://t.no.mt/static/image/smiley/default/tounge_smile.gif">');
	});

	it("rewrites https://bbs.tongji.net/images/smiles/ to CDN", () => {
		const input = '<img src="https://bbs.tongji.net/images/smiles/smile.gif">';
		const result = rewriteLegacyUrls(input);
		expect(result).toBe('<img src="https://t.no.mt/static/image/smiley/default/smile.gif">');
	});

	it("rewrites /images/common/ to CDN common path", () => {
		const input = '<img src="http://bbs.tongji.net/images/common/back.gif">';
		const result = rewriteLegacyUrls(input);
		expect(result).toBe('<img src="https://t.no.mt/static/image/common/back.gif">');
	});

	it("handles multiple URLs in same content", () => {
		const input =
			'<img src="http://bbs.tongji.net/images/smiles/a.gif"> text <img src="http://bbs.tongji.net/images/smiles/b.gif">';
		const result = rewriteLegacyUrls(input);
		expect(result).toContain("https://t.no.mt/static/image/smiley/default/a.gif");
		expect(result).toContain("https://t.no.mt/static/image/smiley/default/b.gif");
	});

	it("leaves other URLs unchanged", () => {
		const input = '<img src="https://example.com/image.gif">';
		const result = rewriteLegacyUrls(input);
		expect(result).toBe(input);
	});
});

// ---------------------------------------------------------------------------
// filterContent (integration)
// ---------------------------------------------------------------------------

describe("filterContent", () => {
	it("returns empty string unchanged", () => {
		expect(filterContent("")).toBe("");
	});

	it("returns null/undefined unchanged", () => {
		// @ts-expect-error testing edge case
		expect(filterContent(null)).toBe(null);
		// @ts-expect-error testing edge case
		expect(filterContent(undefined)).toBe(undefined);
	});

	it("processes edit notices, BBCode, and smileys together", () => {
		const input =
			"[i=s] 本帖最后由 测试用户 于 2024-6-1 12:00 编辑 </em>\n\n[fly]飞行文字[/fly] :smile:";
		const result = filterContent(input);

		// Edit notice should be transformed
		expect(result).toContain('class="dz-edit-notice"');
		expect(result).toContain("测试用户");

		// [fly] should be stripped
		expect(result).not.toContain("[fly]");
		expect(result).toContain("飞行文字");

		// Smiley should be converted to img
		expect(result).toContain('<img src="');
		expect(result).toContain('class="smiley"');
	});

	it("handles real-world Discuz content", () => {
		const input = `[i=s] 本帖最后由 蓝天月光 于 2012-11-20 09:37 编辑 </em>

极其全面，上了一课,hehe
&lt;!-- CETagParser ~color=#9932CC
&lt;font color=&quot;#9932CC&quot;&gt;紫色文字&lt;!-- CETagParser ~/color
&lt;/font&gt;`;

		const result = filterContent(input);

		// Edit notice transformed
		expect(result).toContain('class="dz-edit-notice"');
		expect(result).toContain("蓝天月光");

		// CETagParser removed
		expect(result).not.toContain("CETagParser");
		expect(result).toContain("紫色文字");

		// Content preserved
		expect(result).toContain("极其全面");
	});

	it("preserves line breaks in content", () => {
		const input = "第一行\n第二行\r\n第三行";
		const result = filterContent(input);
		expect(result).toContain("\n");
		expect(result).toContain("\r\n");
	});

	it("handles content with only smiley codes", () => {
		const input = ":smile: :biggrin: :cry:";
		const result = filterContent(input);
		expect(result).toContain('<img src="');
		expect((result.match(/class="smiley"/g) || []).length).toBe(3);
	});

	it("handles content with nested BBCode tags", () => {
		const input = "[align=center][fly]居中飞行[/fly][/align]";
		const result = filterContent(input);
		expect(result).toBe('<div style="text-align:center">居中飞行</div>');
	});

	it("handles mixed HTML and BBCode", () => {
		const input = "<strong>粗体</strong>[fly]飞行[/fly]<em>斜体</em>";
		const result = filterContent(input);
		// [fly] tags stripped, HTML preserved
		expect(result).toContain("<strong>粗体</strong>");
		expect(result).toContain("飞行");
		expect(result).toContain("<em>斜体</em>");
		expect(result).not.toContain("[fly]");
	});
});

// ---------------------------------------------------------------------------
// Edge cases and security
// ---------------------------------------------------------------------------

describe("security", () => {
	it("escapes HTML in edit notice username", () => {
		const input = "[i=s] 本帖最后由 <img src=x onerror=alert(1)> 于 2024-1-1 00:00 编辑 </em>";
		const result = filterContent(input);
		// The angle brackets should be escaped, preventing XSS
		expect(result).toContain("&lt;img");
		expect(result).toContain("&gt;");
		// Original unescaped tags should not exist
		expect(result).not.toContain("<img src=x");
	});

	it("leaves malformed BBCode unchanged rather than breaking", () => {
		// Malformed BBCode with injection attempt should NOT be processed
		// because the regex won't match — this is the safer behavior
		const input =
			'[align=center"><script>alert(1)</script><div style="text-align:center]test[/align]';
		const result = filterContent(input);
		// The malformed BBCode is left as-is since it doesn't match valid patterns
		// This is safe because the content will be rendered via dangerouslySetInnerHTML
		// in a context where we trust the original HTML (migrated from Discuz)
		expect(result).toContain("[align=");
	});

	it("handles valid align BBCode safely", () => {
		const input = "[align=center]<script>alert(1)</script>[/align]";
		const result = filterContent(input);
		// Valid BBCode is processed, but the script inside is preserved
		// (Discuz migration data is trusted — we're not sanitizing all HTML)
		expect(result).toContain('style="text-align:center"');
	});
});

// ---------------------------------------------------------------------------
// CETagParser legacy decode pipeline (entity-encoded content → renderable HTML)
// ---------------------------------------------------------------------------

describe("CETagParser legacy decode pipeline", () => {
	describe("five tag kinds (single-encoded)", () => {
		it("~size produces <font size> that survives sanitization", () => {
			const input =
				"&lt;!-- CETagParser ~size=5\r\n&lt;font size=5&gt;大字&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;";
			const result = filterContent(input);
			expect(result).toMatch(/<font[^>]*size="?5"?[^>]*>/);
			expect(result).toContain("大字");
			expect(result).not.toContain("CETagParser");
		});

		it("~color produces <font color> that survives sanitization", () => {
			const input =
				"&lt;!-- CETagParser ~color=#FF0000\r\n&lt;font color=&quot;#FF0000&quot;&gt;红色&lt;!-- CETagParser ~/color\r\n&lt;/font&gt;";
			const result = filterContent(input);
			expect(result).toMatch(/<font[^>]*color="?#FF0000"?[^>]*>/i);
			expect(result).toContain("红色");
			expect(result).not.toContain("CETagParser");
		});

		it("~font keeps inner content visible", () => {
			const input =
				"&lt;!-- CETagParser ~font=Arial\r\n&lt;font face=&quot;Arial&quot;&gt;字体内容&lt;!-- CETagParser ~/font\r\n&lt;/font&gt;";
			const result = filterContent(input);
			expect(result).toContain("字体内容");
			expect(result).not.toContain("CETagParser");
		});

		it("~url produces <a href> that survives sanitization", () => {
			const input =
				"&lt;!-- CETagParser ~url=http://example.com\r\n&lt;a href=&quot;http://example.com&quot; target=&quot;_blank&quot;&gt;链接文字&lt;!-- CETagParser ~/url\r\n&lt;/a&gt;";
			const result = filterContent(input);
			expect(result).toMatch(/<a[^>]*href="?http:\/\/example\.com"?/i);
			expect(result).toContain("链接文字");
			expect(result).not.toContain("CETagParser");
		});

		it("~email produces mailto link that survives sanitization", () => {
			const input =
				"&lt;!-- CETagParser ~email=a@b.com\r\n&lt;a href=&quot;mailto:a@b.com&quot;&gt;给我发邮件&lt;!-- CETagParser ~/email\r\n&lt;/a&gt;";
			const result = filterContent(input);
			expect(result).toMatch(/<a[^>]*href="?mailto:a@b\.com"?/i);
			expect(result).toContain("给我发邮件");
			expect(result).not.toContain("CETagParser");
		});
	});

	it("strips all CETagParser comment markers", () => {
		const input =
			"&lt;!-- CETagParser ~size=2\r\n&lt;font size=2&gt;A&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;B&lt;!-- CETagParser ~color=#000\r\n&lt;font color=&quot;#000&quot;&gt;C&lt;!-- CETagParser ~/color\r\n&lt;/font&gt;";
		const result = filterContent(input);
		expect(result).not.toContain("CETagParser");
		expect(result).not.toMatch(/<!--/);
		expect(result).toContain("A");
		expect(result).toContain("B");
		expect(result).toContain("C");
	});

	it("treats single-encoded, double-encoded, and raw input equivalently", () => {
		const single =
			"&lt;!-- CETagParser ~size=3\r\n&lt;font size=3&gt;同样的内容&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;";
		const doubled =
			"&amp;lt;!-- CETagParser ~size=3\r\n&amp;lt;font size=3&amp;gt;同样的内容&amp;lt;!-- CETagParser ~/size\r\n&amp;lt;/font&amp;gt;";
		const raw =
			'<!-- CETagParser ~size=3\r\n<font size="3">同样的内容<!-- CETagParser ~/size\r\n</font>';

		const r1 = filterContent(single);
		const r2 = filterContent(doubled);
		const r3 = filterContent(raw);

		for (const r of [r1, r2, r3]) {
			expect(r).toContain("同样的内容");
			expect(r).toMatch(/<font[^>]*size="?3"?/);
			expect(r).not.toContain("CETagParser");
		}
	});

	it("decodes numeric entity refs (decimal and hex)", () => {
		// Real CETagParser always wraps the marker line with \r\n; numeric
		// refs simply replace the `&lt;` / `&gt;` mechanism.
		const decimal = "&#60;!-- CETagParser ~size=4\r\n&#60;font size=4&#62;十进制&#60;/font&#62;";
		const hex = "&#x3c;!-- CETagParser ~size=4\r\n&#x3c;font size=4&#x3e;十六进制&#x3c;/font&#x3e;";
		const r1 = filterContent(decimal);
		const r2 = filterContent(hex);
		expect(r1).toContain("十进制");
		expect(r2).toContain("十六进制");
		expect(r1).not.toContain("CETagParser");
		expect(r2).not.toContain("CETagParser");
	});

	it("handles mixed encoded outer + raw inner markers", () => {
		// Mixed-encoding posts (encoded outer + raw inner) are rare in the
		// production D1 (~3.7k of 9.5M). We don't try to perfectly preserve
		// inner markup — the textContent decode flattens it — but the visible
		// text must survive and no CETagParser strings must leak.
		const input =
			'&lt;!-- CETagParser ~size=2\r\n&lt;font size=2&gt;外层<!-- CETagParser ~color=#0F0\r\n<font color="#0F0">内层</font></font>';
		const result = filterContent(input);
		expect(result).toContain("外层");
		expect(result).not.toContain("CETagParser");
	});

	it("does not throw on unbalanced <font> tags", () => {
		const input = "&lt;!-- CETagParser ~size=5\r\n&lt;font size=5&gt;只有开标签没有闭标签";
		expect(() => filterContent(input)).not.toThrow();
		const result = filterContent(input);
		expect(result).toContain("只有开标签没有闭标签");
		expect(result).not.toContain("CETagParser");
	});

	it("collapses trailing \\r\\n with stripped comments (no large blank gaps)", () => {
		const input =
			"前&lt;!-- CETagParser ~size=2\r\n&lt;font size=2&gt;中&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;后";
		const result = filterContent(input);
		// No more than 2 consecutive newlines should appear from comment stripping
		expect(result).not.toMatch(/\n{4,}/);
		expect(result).toContain("前");
		expect(result).toContain("中");
		expect(result).toContain("后");
	});

	it("gate isolation — non-CETagParser content with literal &lt;font…&gt; stays encoded", () => {
		// Content does NOT include the CETagParser token, so the legacy branch
		// must not fire and the encoded literal must reach sanitize as-is.
		const input = "纯文字介绍 &lt;font size=5&gt; 这是字面量";
		const result = filterContent(input);
		// DOMPurify on the modern branch may re-encode `&lt;` as `&lt;` (it's
		// already escaped text — sanitize preserves it). Either way the angle
		// brackets must not have been decoded into real tags.
		expect(result).not.toMatch(/<font[^>]*size="?5"?[^>]*>/);
		expect(result).toContain("纯文字介绍");
	});

	it("strips <script> embedded in legacy CETagParser content (XSS)", () => {
		const input =
			"&lt;!-- CETagParser ~size=2\r\n&lt;font size=2&gt;&lt;script&gt;alert(1)&lt;/script&gt;OK&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;";
		const result = filterContent(input);
		expect(result).not.toContain("<script");
		expect(result).not.toContain("alert(1)");
		expect(result).toContain("OK");
	});

	it("blocks javascript: hrefs decoded from legacy content", () => {
		const input =
			"&lt;!-- CETagParser ~url=javascript:alert(1)\r\n&lt;a href=&quot;javascript:alert(1)&quot;&gt;evil&lt;!-- CETagParser ~/url\r\n&lt;/a&gt;";
		const result = filterContent(input);
		expect(result).not.toMatch(/href\s*=\s*"?javascript:/i);
	});

	it("replaces smiley codes inside decoded legacy content", () => {
		const input =
			"&lt;!-- CETagParser ~size=3\r\n&lt;font size=3&gt;hi :smile: there&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;";
		const result = filterContent(input);
		expect(result).toContain('class="smiley"');
		// Smiley replacement renders as <img alt=":smile:" …>, so the literal
		// `:smile:` survives only inside the alt attribute — assert by counting
		// occurrences instead of by absence.
		expect(result).not.toMatch(/(^|[^"]):smile:(?!")/);
		expect(result).toContain("hi");
		expect(result).toContain("there");
	});

	it("renders the real D1 post #91 sample shape (nested size + color)", () => {
		// Approximate the production sample: outer <font size=2>, inner
		// <font color="#CD5C5C"> with text between CETagParser comments.
		const input =
			"&lt;!-- CETagParser ~size=2\r\n&lt;font size=2&gt;：&lt;!-- CETagParser ~color=#CD5C5C\r\n&lt;font color=&quot;#CD5C5C&quot;&gt;在公共场所遛狗的&lt;!-- CETagParser ~/color\r\n&lt;/font&gt;请拴绳&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;";
		const result = filterContent(input);
		expect(result).toMatch(/<font[^>]*size="?2"?/);
		expect(result).toMatch(/<font[^>]*color="?#CD5C5C"?/i);
		expect(result).toContain("在公共场所遛狗的");
		expect(result).toContain("请拴绳");
		expect(result).not.toContain("CETagParser");
	});
});
