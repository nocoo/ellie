// Shared display pipeline for forum posts and signatures, on the server and in the browser.
import { decodeHTML } from "entities";
import sanitize from "sanitize-html";
import { replaceSmileyCodesWithImages } from "./smiley";

// ---------------------------------------------------------------------------
// Edit notice transformation
// ---------------------------------------------------------------------------

// Pattern: [i=s] 本帖最后由 XXX 于 YYYY-M-D HH:MM 编辑 </em>
// Also handles: [i=s] 本帖最后由 XXX 于 YYYY-M-D HH:MM 编辑 [/i]
const RE_EDIT_NOTICE =
	/\[i=s\]\s*本帖最后由\s+(.+?)\s+于\s+(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2})\s+编辑\s*(?:<\/em>|\[\/i\])?/g;

/**
 * Transform Discuz edit notices into styled HTML.
 * Renders as centered, muted, smaller text.
 */
function transformEditNotices(html: string): string {
	return html.replace(RE_EDIT_NOTICE, (_match, username, datetime) => {
		const escapedUser = escapeHtml(username);
		const escapedTime = escapeHtml(datetime);
		return `<div class="dz-edit-notice">本帖最后由 ${escapedUser} 于 ${escapedTime} 编辑</div>`;
	});
}

// ---------------------------------------------------------------------------
// Legacy BBCode cleanup
// ---------------------------------------------------------------------------

// [fly]text[/fly] — Discuz marquee effect, render as normal text
const RE_FLY = /\[fly\]([\s\S]*?)\[\/fly\]/gi;

// [glow=width,color,times]text[/glow] — Discuz glow effect
const RE_GLOW = /\[glow=([^\]]*)\]([\s\S]*?)\[\/glow\]/gi;

// [shadow=width,color,direction]text[/shadow] — Discuz shadow effect
const RE_SHADOW = /\[shadow=([^\]]*)\]([\s\S]*?)\[\/shadow\]/gi;

// [move]text[/move] — Discuz scrolling text
const RE_MOVE = /\[move\]([\s\S]*?)\[\/move\]/gi;

// [align=center|left|right]text[/align] — Text alignment
const RE_ALIGN = /\[align=(center|left|right)\]([\s\S]*?)\[\/align\]/gi;

// [font=name]text[/font] — Font family (strip, keep text)
const RE_FONT = /\[font=[^\]]*\]([\s\S]*?)\[\/font\]/gi;

// Residual color BBCode is display-only metadata; strip tokens, including nested pairs.
const RE_COLOR = /\[\/?color(?:=[^\]]*)?\]/gi;

// [backcolor=color]text[/backcolor] — Background color (strip)
const RE_BACKCOLOR = /\[backcolor=[^\]]*\]([\s\S]*?)\[\/backcolor\]/gi;

// [free]text[/free] — Free content block (strip tags, keep content)
const RE_FREE = /\[free\]([\s\S]*?)\[\/free\]/gi;

// [hide]text[/hide] — Hidden content (could add "hidden content" placeholder)
const RE_HIDE = /\[hide\]([\s\S]*?)\[\/hide\]/gi;

// [hide=credits]text[/hide] — Hidden content with credit requirement
const RE_HIDE_CREDITS = /\[hide=\d+\]([\s\S]*?)\[\/hide\]/gi;

// Orphan [i=s] without matching edit notice pattern — likely broken markup
const RE_ORPHAN_IS = /\[i=s\]\s*/gi;

// Orphan </em> from malformed edit notices — only match when preceded by edit-related text
// Don't match standalone </em> tags which might be valid HTML
const RE_ORPHAN_EDIT_EM = /编辑\s*<\/em>/gi;

// [p=indent,lineHeight,align]text[/p] — Discuz paragraph formatting
const RE_PARAGRAPH = /\[p=([^\]]*)\]([\s\S]*?)\[\/p\]/gi;

// [float=left|right]text[/float] — Float positioning
const RE_FLOAT = /\[float=(left|right)\]([\s\S]*?)\[\/float\]/gi;

/**
 * Clean up legacy BBCode that wasn't converted during migration.
 * Strips formatting tags while preserving content.
 */
function cleanupLegacyBBCode(html: string): string {
	let result = html;

	// Transform [fly] to normal text (was marquee scrolling)
	result = result.replace(RE_FLY, "$1");

	// Transform [move] to normal text
	result = result.replace(RE_MOVE, "$1");

	// Transform [glow] to normal text
	result = result.replace(RE_GLOW, "$2");

	// Transform [shadow] to normal text
	result = result.replace(RE_SHADOW, "$2");

	// Transform [align] to div with alignment
	result = result.replace(RE_ALIGN, (_match, align, content) => {
		const safeAlign = align.toLowerCase();
		if (safeAlign === "center" || safeAlign === "left" || safeAlign === "right") {
			return `<div style="text-align:${safeAlign}">${content}</div>`;
		}
		return content;
	});

	// Strip [font] tags, keep content
	result = result.replace(RE_FONT, "$1");
	result = result.replace(RE_COLOR, "");

	// Strip [backcolor] tags, keep content
	result = result.replace(RE_BACKCOLOR, "$1");

	// Strip [free] tags, keep content
	result = result.replace(RE_FREE, "$1");

	// Transform [hide] to placeholder
	result = result.replace(RE_HIDE, '<div class="dz-hidden-content">[隐藏内容]</div>');

	// Transform [hide=N] to placeholder with credit info
	result = result.replace(
		RE_HIDE_CREDITS,
		'<div class="dz-hidden-content">[需要积分查看的隐藏内容]</div>',
	);

	// Strip [p] paragraph tags, keep content
	result = result.replace(RE_PARAGRAPH, "$2");

	// Transform [float] to styled div
	result = result.replace(RE_FLOAT, (_match, direction, content) => {
		const safeDir = direction.toLowerCase();
		if (safeDir === "left" || safeDir === "right") {
			return `<div style="float:${safeDir}">${content}</div>`;
		}
		return content;
	});

	// Clean up orphan [i=s] tags (after edit notice processing)
	result = result.replace(RE_ORPHAN_IS, "");

	// Clean up orphan </em> tags only when they follow "编辑" (malformed edit notices)
	result = result.replace(RE_ORPHAN_EDIT_EM, "编辑");

	return result;
}

// ---------------------------------------------------------------------------
// CETagParser cleanup — legacy Discuz template artifacts
// ---------------------------------------------------------------------------

// <!-- CETagParser ~color=#XXX followed by <font color="..."> — legacy color markup
// Note: These are HTML-encoded in the database, matching &lt; and &gt;
const RE_CETAGPARSER_COLOR =
	/&lt;!--\s*CETagParser\s+~color=[^-]*\r?\n?&lt;font\s+color=&quot;[^&]*&quot;&gt;/gi;

// <!-- CETagParser ~/color followed by </font> — closing color tag
const RE_CETAGPARSER_COLOR_CLOSE = /&lt;!--\s*CETagParser\s+~\/color\r?\n?&lt;\/font&gt;/gi;

// <!-- CETagParser ~quote and ~/quote
const RE_CETAGPARSER_QUOTE = /&lt;!--\s*CETagParser\s+~\/?quote[^&]*&gt;/gi;

// <!-- CETagParser ~url and ~/url
const RE_CETAGPARSER_URL = /&lt;!--\s*CETagParser\s+~\/?url[^&]*&gt;/gi;

// Generic CETagParser comments (catch-all)
const RE_CETAGPARSER_GENERIC = /&lt;!--\s*CETagParser\s+[^&]*&gt;/gi;

/** Remove encoded migration markers left over after the legacy decode pass. */
function cleanupCETagParser(html: string): string {
	let result = html;

	result = result.replace(RE_CETAGPARSER_COLOR, "");
	result = result.replace(RE_CETAGPARSER_COLOR_CLOSE, "");
	result = result.replace(RE_CETAGPARSER_QUOTE, "");
	result = result.replace(RE_CETAGPARSER_URL, "");
	result = result.replace(RE_CETAGPARSER_GENERIC, "");

	return result;
}

// Match decoded `<!-- CETagParser ... -->` comments AND the Discuz variant
// that omits the closing `-->` and instead terminates at a newline. Discuz
// inserts these comments before/after every formatting tag, so they often
// hug a \r\n that should disappear with them. The alternation handles both:
//   1. proper `<!-- CETagParser … -->\n` (rare, but possible)
//   2. unterminated `<!-- CETagParser …\n` (the production norm)
const RE_CETAGPARSER_DECODED = /<!--\s*CETagParser\s+(?:[^>]*?-->|[^\r\n]*?(?=\r?\n|$))\r?\n?/gi;

/**
 * Strip real `<!-- CETagParser … -->` comments from decoded content while
 * leaving the adjacent `<font>`/`<a>` tags intact.
 */
function stripCETagParserComments(html: string): string {
	return html.replace(RE_CETAGPARSER_DECODED, "");
}

// ---------------------------------------------------------------------------
// Legacy URL rewriting
// ---------------------------------------------------------------------------

// Old Discuz smiley/image URLs that need to be rewritten to CDN
const LEGACY_SMILEY_URLS = [
	"http://bbs.tongji.net/images/smiles/",
	"https://bbs.tongji.net/images/smiles/",
	"http://bbs.tongji.net/images/common/",
	"https://bbs.tongji.net/images/common/",
];

const CDN_SMILEY_BASE = "https://t.no.mt/static/image/smiley/default/";
const CDN_COMMON_BASE = "https://t.no.mt/static/image/common/";

/**
 * Rewrite legacy Discuz image URLs to CDN.
 * Handles old bbs.tongji.net URLs that are no longer accessible.
 */
function rewriteLegacyUrls(html: string): string {
	let result = html;

	// Rewrite smiley URLs
	for (const oldUrl of LEGACY_SMILEY_URLS) {
		if (oldUrl.includes("/smiles/")) {
			result = result.split(oldUrl).join(CDN_SMILEY_BASE);
		} else if (oldUrl.includes("/common/")) {
			result = result.split(oldUrl).join(CDN_COMMON_BASE);
		}
	}

	return result;
}

// HTML allowlist shared by modern and migrated content.
const ALLOWED_TAGS = [
	// Text formatting
	"p",
	"br",
	"hr",
	"span",
	"div",
	"strong",
	"b",
	"em",
	"i",
	"u",
	"s",
	"strike",
	"del",
	"ins",
	"sub",
	"sup",
	"small",
	"mark",
	// Headings
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	// Lists
	"ul",
	"ol",
	"li",
	// Links and images
	"a",
	"img",
	// Tables
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	// Quotes and code
	"blockquote",
	"pre",
	"code",
	// Other
	"figure",
	"figcaption",
	"font",
	"center",
];

const ALLOWED_ATTR = [
	"class",
	"id",
	"title",
	"lang",
	"dir",
	"aria-*",
	"href",
	"target",
	"rel",
	"src",
	"alt",
	"width",
	"height",
	"loading",
	"colspan",
	"rowspan",
	"scope",
	"color",
	"size",
	"face",
	"align",
	"valign",
	"border",
	"cellpadding",
	"cellspacing",
	"bgcolor",
	"style",
];

/** Sanitize after transformations so decoded legacy HTML follows the same rules. */
function sanitizeHtml(html: string): string {
	return sanitize(html, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: { "*": ALLOWED_ATTR },
		allowedSchemes: ["http", "https", "ftp", "mailto"],
		allowedSchemesByTag: { img: ["http", "https"] },
		allowedStyles: {
			"*": {
				"text-align": [/^(left|center|right)$/],
				float: [/^(left|right)$/],
			},
		},
		transformTags: {
			a: sanitize.simpleTransform("a", { target: "_blank", rel: "nofollow noopener noreferrer" }),
		},
		nonTextTags: [
			"script",
			"style",
			"textarea",
			"option",
			"xmp",
			"iframe",
			"object",
			"svg",
			"math",
			"template",
			"noscript",
		],
	});
}

/** Escape HTML special characters for safe insertion. */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

/** Render raw post/signature HTML with the forum's legacy markup and smiley support. */
export function renderContent(content: string): string {
	if (!content) return content;

	let result = content;
	if (result.includes("CETagParser")) {
		// Migrated posts can be encoded once or twice. Decode without flattening raw tags.
		result = stripCETagParserComments(decodeHTML(decodeHTML(result)));
	}
	result = rewriteLegacyUrls(result);
	result = transformEditNotices(result);
	result = cleanupLegacyBBCode(result);
	result = cleanupCETagParser(result);
	result = replaceSmileyCodesWithImages(result);
	return sanitizeHtml(result);
}

const TEXT_BREAK_TAGS = new Set([
	"p",
	"br",
	"hr",
	"div",
	"blockquote",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"ul",
	"ol",
	"li",
	"table",
	"tr",
	"td",
	"th",
	"figure",
	"figcaption",
	"center",
]);
const RE_BBCODE_TAG =
	/\[\/?(?:b|i|u|s|strike|color|size|font|url|email|img|quote|code|list|\*|table|tr|td)(?:=[^\]]*)?\]/gi;

/** Plain text for summaries, titles and tooltips. Render as text, never as HTML. */
export function contentToText(content: string | null | undefined): string {
	if (!content) return "";
	let text = "";
	sanitize(renderContent(content), {
		allowedTags: [],
		allowedAttributes: {},
		onOpenTag(tag, attributes) {
			if (TEXT_BREAK_TAGS.has(tag)) text += " ";
			if (tag === "img") text += ` ${attributes.alt || "[图片]"} `;
		},
		onCloseTag(tag) {
			if (TEXT_BREAK_TAGS.has(tag)) text += " ";
		},
		textFilter(value) {
			text += decodeHTML(value);
			return "";
		},
	});
	return text.replace(RE_BBCODE_TAG, "").replace(/\s+/g, " ").trim();
}

// Existing transformation tests exercise these helpers directly.
export {
	cleanupCETagParser,
	cleanupLegacyBBCode,
	escapeHtml,
	RE_ALIGN,
	RE_EDIT_NOTICE,
	RE_FLY,
	RE_HIDE,
	rewriteLegacyUrls,
	sanitizeHtml,
	transformEditNotices,
};
