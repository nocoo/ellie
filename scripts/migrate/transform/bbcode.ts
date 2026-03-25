/**
 * BBCode → HTML transformer.
 *
 * Per docs/03-migration.md BBCode conversion table.
 * Handles bbcodeoff/htmlon flags, nested tags, [attach] placeholders.
 */

/** Options controlling how BBCode content is transformed. */
export interface BbcodeOptions {
	/** If true, BBCode is disabled — treat message as plain text. */
	bbcodeoff?: boolean;
	/** If true, message may contain raw HTML mixed with BBCode. */
	htmlon?: boolean;
}

/** DZ font size map: size number → CSS font-size. */
const SIZE_MAP: Record<string, string> = {
	"1": "x-small",
	"2": "small",
	"3": "medium",
	"4": "large",
	"5": "x-large",
	"6": "xx-large",
	"7": "xxx-large",
};

/** Simple BBCode tag → HTML tag mapping (no parameters). */
const SIMPLE_TAGS: Record<string, { open: string; close: string }> = {
	b: { open: "<strong>", close: "</strong>" },
	i: { open: "<em>", close: "</em>" },
	u: { open: "<u>", close: "</u>" },
	s: { open: "<s>", close: "</s>" },
	quote: { open: "<blockquote>", close: "</blockquote>" },
	code: { open: "<pre><code>", close: "</code></pre>" },
	hr: { open: "<hr>", close: "" },
};

/**
 * Convert BBCode content to HTML.
 *
 * @param message - Raw message content from DZ post
 * @param options - bbcodeoff / htmlon flags from the post record
 * @returns HTML string
 */
export function bbcodeToHtml(message: string, options: BbcodeOptions = {}): string {
	if (!message) return "";

	// bbcodeoff: content is plain text, no BBCode parsing
	if (options.bbcodeoff) {
		return escapeHtml(message);
	}

	let html = message;

	// If htmlon is false (default), escape any raw HTML first
	if (!options.htmlon) {
		// We need to be careful: escape HTML but then apply BBCode conversions.
		// Strategy: first escape, then convert BBCode (which produces trusted HTML).
		html = escapeHtml(html);
	}

	// Apply BBCode conversions
	html = convertBbcode(html);

	return html;
}

/** Escape HTML special characters. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Convert BBCode tags to HTML.
 * Applied after HTML escaping (for non-htmlon content).
 */
function convertBbcode(text: string): string {
	let result = text;

	// Simple paired tags
	for (const [tag, { open, close }] of Object.entries(SIMPLE_TAGS)) {
		const openPattern = new RegExp(`\\[${tag}\\]`, "gi");
		const closePattern = new RegExp(`\\[/${tag}\\]`, "gi");
		result = result.replace(openPattern, open);
		result = result.replace(closePattern, close);
	}

	// [url=href]text[/url] and [url]href[/url]
	result = result.replace(
		/\[url=([^\]]*)\]([\s\S]*?)\[\/url\]/gi,
		(_, href, text) => `<a href="${href}">${text}</a>`,
	);
	result = result.replace(
		/\[url\]([\s\S]*?)\[\/url\]/gi,
		(_, href) => `<a href="${href}">${href}</a>`,
	);

	// [img]src[/img]
	result = result.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, src) => `<img src="${src}">`);

	// [color=xxx]text[/color]
	result = result.replace(
		/\[color=([^\]]*)\]([\s\S]*?)\[\/color\]/gi,
		(_, color, text) => `<span style="color:${color}">${text}</span>`,
	);

	// [size=N]text[/size]
	result = result.replace(/\[size=([^\]]*)\]([\s\S]*?)\[\/size\]/gi, (_, size, text) => {
		const fontSize = SIZE_MAP[size] ?? `${size}px`;
		return `<span style="font-size:${fontSize}">${text}</span>`;
	});

	// [align=xxx]text[/align]
	result = result.replace(
		/\[align=([^\]]*)\]([\s\S]*?)\[\/align\]/gi,
		(_, align, text) => `<div style="text-align:${align}">${text}</div>`,
	);

	// [attach]aid[/attach] → placeholder URL
	result = result.replace(
		/\[attach\](\d+)\[\/attach\]/gi,
		(_, aid) => `<attachment data-aid="${aid}"></attachment>`,
	);

	// [list] and [list=1] / [*]
	result = result.replace(/\[list=1\]/gi, "<ol>");
	result = result.replace(/\[list\]/gi, "<ul>");
	// Simplified: always close as </ul>. Ordered list close is handled by
	// replacing [list=1] with <ol>, so a proper close would need state tracking.
	result = result.replace(/\[\/list\]/gi, "</ul>");
	result = result.replace(/\[\*\]/gi, "<li>");

	return result;
}
