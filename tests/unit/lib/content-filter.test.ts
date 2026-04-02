import { describe, expect, it } from "bun:test";
import {
	cleanupCETagParser,
	cleanupLegacyBBCode,
	filterContent,
	rewriteLegacyUrls,
	transformEditNotices,
} from "../../../apps/web/src/lib/content-filter";

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
