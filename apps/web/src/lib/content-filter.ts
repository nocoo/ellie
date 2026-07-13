// content-filter.ts — Unified content transformation pipeline for Discuz migrated content
//
// Transforms raw post/signature content for display:
// 1. Smiley codes → <img> tags (delegated to smiley.ts)
// 2. Edit notices → styled center-aligned text
// 3. Legacy BBCode → HTML or stripped
// 4. HTML sanitization (DOMPurify whitelist)
//
// Security: HTML is sanitized with DOMPurify whitelist before rendering.
// All transformations use closed whitelists or pattern matching.

import DOMPurify from "dompurify";
import { parseHTML } from "linkedom";
import { replaceSmileyCodesWithImages } from "./smiley";

// Create a DOM environment for server-side DOMPurify
const { window } = parseHTML("<!DOCTYPE html><html><body></body></html>");
// biome-ignore lint/suspicious/noExplicitAny: DOMPurify requires Window-like from linkedom, but types don't match
const purify = DOMPurify(window as any);

// ---------------------------------------------------------------------------
// HTML entity decoding (legacy CETagParser content)
// ---------------------------------------------------------------------------

/**
 * Decode HTML entities by parsing into a synthetic `<div>` and reading
 * `.textContent` — this handles named refs (`&lt;`, `&quot;`, …), numeric
 * refs (`&#60;`), and hex refs (`&#x3c;`) uniformly, without a hand-rolled
 * lookup map. Returns the input unchanged if no entities decode.
 *
 * If `repeat` is true, decode up to twice (for content that was
 * double-encoded during legacy migration).
 *
 * NOTE: linkedom's `<textarea>.value` does NOT decode entities the way
 * jsdom/browsers do; `div.textContent` after `innerHTML=` does. We use the
 * div variant so the pipeline behaves identically to a browser.
 */
function decodeHtmlEntities(input: string, repeat = true): string {
	if (!input?.includes("&")) return input;
	const decode = (s: string): string => {
		const doc = parseHTML("<!DOCTYPE html><html><body></body></html>");
		const div = doc.document.createElement("div");
		div.innerHTML = s;
		return div.textContent ?? s;
	};
	let result = decode(input);
	// Double-encoded posts surface as `&amp;lt;` in the source, which becomes
	// `&lt;` after the first pass — at that point the comment markers are
	// still encoded and would never match `RE_CETAGPARSER_DECODED`. Decode
	// once more so the markers reach the strip step as real `<!--`.
	if (repeat && /&(?:lt|gt|amp|quot|#\d+|#x[0-9a-f]+);/i.test(result) && result !== input) {
		result = decode(result);
	}
	return result;
}

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

/**
 * Legacy cleanup for already-encoded CETagParser markers.
 *
 * NOTE: this is the **fallback path** used when content somehow reaches the
 * filter still entity-encoded — the modern path (see `processLegacyCETagParser`)
 * decodes entities first and then strips real `<!-- … -->` comments instead.
 * Kept exported for back-compat and the existing test suite.
 */
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

/**
 * Decode entity-encoded CETagParser content into renderable HTML.
 *
 * Pipeline (legacy branch only):
 *  1. Decode HTML entities (up to 2× for double-encoded migrations).
 *  2. Strip `<!-- CETagParser … -->` comments — they should never reach
 *     `dangerouslySetInnerHTML` as visible text.
 *  3. Sanitize via a text-level whitelist tailored to CETagParser output
 *     (font/a + a tight attribute allowlist). We do NOT use DOMPurify
 *     here because the linkedom-backed DOMPurify in this file is a silent
 *     no-op (linkedom doesn't implement `document.implementation`), and
 *     swapping in jsdom is out of scope for this fix.
 */
function processLegacyCETagParser(html: string): string {
	let result = decodeHtmlEntities(html, true);
	result = stripCETagParserComments(result);
	result = sanitizeLegacyHtml(result);
	return result;
}

// ---------------------------------------------------------------------------
// Text-level whitelist sanitizer (legacy CETagParser branch only)
// ---------------------------------------------------------------------------

// Tags allowed inside decoded CETagParser content. CETagParser only emits
// <font> and <a>; we additionally permit a small inline-formatting set in
// case the post mixed in pre-encoded inline HTML.
const LEGACY_TAG_ALLOWLIST: Record<string, Set<string>> = {
	font: new Set(["color", "size", "face"]),
	a: new Set(["href", "title", "target", "rel"]),
	br: new Set(),
	strong: new Set(),
	b: new Set(),
	em: new Set(),
	i: new Set(),
	u: new Set(),
	s: new Set(),
	span: new Set(),
	p: new Set(),
	div: new Set(),
};

const LEGACY_TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)?\/?>/g;
const LEGACY_ATTR_RE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

function isSafeLegacyHref(value: string): boolean {
	const trimmed = value.trim().toLowerCase();
	return !/^(javascript|data|vbscript)\s*:/i.test(trimmed);
}

/**
 * Strip every tag outside `LEGACY_TAG_ALLOWLIST`, drop disallowed attributes,
 * and reject `javascript:` / `data:` / `vbscript:` hrefs. Content of stripped
 * tags is preserved (textContent style) — except `<script>` / `<style>`
 * blocks, whose textContent IS the payload and gets removed wholesale.
 */
function sanitizeLegacyHtml(html: string): string {
	// 1. Drop the entire <script>…</script> / <style>…</style> block (content
	//    and tags), since the contents themselves would execute / restyle.
	let result = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
	result = result.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
	// Defensive: also drop dangling open tags with no closing pair.
	result = result.replace(/<script\b[^>]*>/gi, "");
	result = result.replace(/<style\b[^>]*>/gi, "");

	// 2. Walk every tag; whitelist-or-strip.
	return result.replace(LEGACY_TAG_RE, (match, tagName: string, attrString: string) => {
		const tag = tagName.toLowerCase();
		const allowed = LEGACY_TAG_ALLOWLIST[tag];
		if (!allowed) return ""; // strip unknown tags, keep inner text
		if (match.startsWith("</")) return `</${tag}>`;
		if (allowed.size === 0) return `<${tag}>`;

		const safeAttrs = collectSafeLegacyAttrs(attrString || "", allowed);
		if (tag === "a") forceLinkSafetyAttrs(safeAttrs);

		const attrStr = safeAttrs.length > 0 ? ` ${safeAttrs.join(" ")}` : "";
		return `<${tag}${attrStr}>`;
	});
}

function collectSafeLegacyAttrs(raw: string, allowed: Set<string>): string[] {
	const safeAttrs: string[] = [];
	LEGACY_ATTR_RE.lastIndex = 0;
	for (let m = LEGACY_ATTR_RE.exec(raw); m !== null; m = LEGACY_ATTR_RE.exec(raw)) {
		const attrName = m[1].toLowerCase();
		const attrValue = m[2] ?? m[3] ?? m[4] ?? "";
		if (!isSafeLegacyAttr(attrName, attrValue, allowed)) continue;
		safeAttrs.push(`${attrName}="${escapeAttr(attrValue)}"`);
	}
	return safeAttrs;
}

function isSafeLegacyAttr(name: string, value: string, allowed: Set<string>): boolean {
	if (!allowed.has(name)) return false;
	if (/^on/i.test(name)) return false; // event handlers
	if (name === "href" && !isSafeLegacyHref(value)) return false;
	if (/javascript\s*:/i.test(value)) return false;
	return true;
}

function forceLinkSafetyAttrs(safeAttrs: string[]): void {
	if (!safeAttrs.some((a) => a.startsWith("rel="))) {
		safeAttrs.push('rel="nofollow noopener"');
	}
	if (!safeAttrs.some((a) => a.startsWith("target="))) {
		safeAttrs.push('target="_blank"');
	}
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
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

// ---------------------------------------------------------------------------
// HTML Sanitization (DOMPurify)
// ---------------------------------------------------------------------------

/**
 * Whitelist of allowed HTML tags for user content.
 * Covers common formatting, images, links, and legacy Discuz elements.
 * NOTE: iframe, video, audio removed for security (embedding, tracking risks)
 */
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

/**
 * Whitelist of allowed HTML attributes.
 * Security-critical: no event handlers (onclick, onerror, etc.)
 * NOTE: style attribute removed to prevent CSS-based attacks
 */
const ALLOWED_ATTR = [
	// Global (no style - prevents CSS injection)
	"class",
	"id",
	"title",
	"lang",
	"dir",
	// Links
	"href",
	"target",
	"rel",
	// Images
	"src",
	"alt",
	"width",
	"height",
	"loading",
	// Tables
	"colspan",
	"rowspan",
	"scope",
	// Legacy Discuz
	"color",
	"size",
	"face",
	"align",
	"valign",
	"border",
	"cellpadding",
	"cellspacing",
	"bgcolor",
];

/**
 * Sanitize HTML content using DOMPurify whitelist.
 * Removes all script tags, event handlers, and dangerous attributes.
 */
function sanitizeHtml(html: string): string {
	return purify.sanitize(html, {
		ALLOWED_TAGS,
		ALLOWED_ATTR,
		ALLOW_DATA_ATTR: false,
		ALLOW_ARIA_ATTR: true,
		// Force all links to open in new tab with noopener
		ADD_ATTR: ["target", "rel"],
		// Forbid javascript: and data: URLs in href/src
		ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
	});
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/** Escape HTML special characters for safe insertion. */
function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Apply all content transformations for display.
 *
 * Two branches:
 * - **Legacy CETagParser branch** — when content contains the `CETagParser`
 *   marker, decode entities (1–2×), strip comments, then sanitize. This
 *   exposes the originally-encoded `<font>` and `<a>` tags so the browser
 *   renders them as structural HTML instead of literal text.
 * - **Modern branch** — sanitize → URL rewrite → edit notices → BBCode →
 *   (no-op) CETagParser cleanup → smileys.
 *
 * Both branches finish with the same downstream transformations
 * (URL rewrite, edit notices, BBCode, smileys).
 *
 * @param content - Raw HTML content from database
 * @returns Transformed and sanitized HTML ready for rendering
 */
export function filterContent(content: string): string {
	if (!content) return content;

	let result: string;
	if (content.includes("CETagParser")) {
		// Legacy branch — decode + strip + sanitize (security-critical pass).
		result = processLegacyCETagParser(content);
	} else {
		// Modern branch — content is already structural HTML; sanitize once.
		result = sanitizeHtml(content);
	}

	result = rewriteLegacyUrls(result);
	result = transformEditNotices(result);
	result = cleanupLegacyBBCode(result);
	// `cleanupCETagParser` is a no-op on the legacy branch (comments already
	// stripped) and on the modern branch (no CETagParser present), but we
	// keep it for defense in depth against partial migration leftovers.
	result = cleanupCETagParser(result);
	result = replaceSmileyCodesWithImages(result);

	return result;
}

// Export internals for testing
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
