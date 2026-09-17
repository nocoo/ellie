import { describe, expect, it } from "vitest";
import { contentToText } from "../src/content";

describe("contentToText", () => {
	it.each([
		["<p>你好&nbsp;<strong>世界</strong> &amp; &#x1f600;</p>", "你好 世界 & 😀"],
		['<span title="a > b">正文</span><!-- comment --><script>evil()</script>', "正文"],
		[
			"<div>A<br>B</div><ul><li>C</li><li>D</li></ul><table><tr><td>E</td><td>F</td></tr></table>",
			"A B C D E F",
		],
		[
			"[b]加粗[/b] [url=https://example.com]链接[/url] [普通备注] [0, 1]",
			"加粗 链接 [普通备注] [0, 1]",
		],
		[
			'<img src="/photo.jpg" alt="照片 &amp; 说明"> :smile: <img src="/other.jpg">',
			"照片 & 说明 :smile: [图片]",
		],
		["前文[hide]不可泄露的内容[/hide]后文", "前文 [隐藏内容] 后文"],
		["&lt;code&gt; &amp;lt; 2 &lt; 3", "<code> &lt; 2 < 3"],
		["\n\t 普通文字\r\n第二行  ", "普通文字 第二行"],
	])("extracts display text from %s", (input, expected) => {
		expect(contentToText(input)).toBe(expected);
	});

	it.each([
		"<!-- CETagParser ~size=5\r\n<font size=5>旧帖<!-- CETagParser ~/size\r\n</font>",
		"&lt;!-- CETagParser ~size=5\r\n&lt;font size=5&gt;旧帖&lt;!-- CETagParser ~/size\r\n&lt;/font&gt;",
		"&amp;lt;!-- CETagParser ~size=5\r\n&amp;lt;font size=5&amp;gt;旧帖&amp;lt;!-- CETagParser ~/size\r\n&amp;lt;/font&amp;gt;",
	])("handles raw and encoded legacy formatting", (input) => {
		expect(contentToText(input)).toBe("旧帖");
	});

	it.each(["", null, undefined])("returns empty text for %s", (input) => {
		expect(contentToText(input)).toBe("");
	});
});
