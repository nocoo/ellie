// content-filter.ts — Unified content transformation pipeline for Discuz migrated content
//
// Transforms raw post/signature content for display:
// 1. Smiley codes → <img> tags (delegated to smiley.ts)
// 2. Edit notices → styled center-aligned text
// 3. Legacy BBCode → HTML or stripped
//
// Security: all transformations use closed whitelists or pattern matching.
// No user input reaches HTML attributes without escaping.

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
 * Clean up CETagParser artifacts from legacy Discuz content.
 * These are HTML-encoded template markers that weren't properly processed.
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
 * Pipeline order:
 * 1. Legacy URL rewriting (fix old bbs.tongji.net image URLs)
 * 2. Edit notices (before BBCode cleanup to avoid orphan tag issues)
 * 3. Legacy BBCode cleanup
 * 4. CETagParser cleanup
 * 5. Smiley codes
 *
 * @param content - Raw HTML content from database
 * @returns Transformed HTML ready for rendering
 */
export function filterContent(content: string): string {
	if (!content) return content;

	let result = content;

	// 1. Rewrite legacy URLs first (before any other processing)
	result = rewriteLegacyUrls(result);

	// 2. Transform edit notices
	result = transformEditNotices(result);

	// 3. Clean up legacy BBCode
	result = cleanupLegacyBBCode(result);

	// 4. Clean up CETagParser artifacts
	result = cleanupCETagParser(result);

	// 5. Replace smiley codes with images
	result = replaceSmileyCodesWithImages(result);

	return result;
}

// Export internals for testing
export {
	transformEditNotices,
	cleanupLegacyBBCode,
	cleanupCETagParser,
	rewriteLegacyUrls,
	escapeHtml,
	RE_EDIT_NOTICE,
	RE_FLY,
	RE_ALIGN,
	RE_HIDE,
};
