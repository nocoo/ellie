/**
 * BBCode → HTML transformer.
 *
 * Per docs/03-migration.md BBCode conversion table.
 * Handles bbcodeoff/htmlon flags, nested tags, [attach] placeholders.
 *
 * Security: URLs are protocol-filtered, CSS values are validated,
 * htmlon content has dangerous tags/attributes stripped.
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

/** Allowed URL protocols. */
const SAFE_PROTOCOLS = /^(https?|ftp|mailto):/i;

/** Allowed CSS color values. */
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{1,30}|rgb\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))$/i;

/** Allowed text-align values. */
const SAFE_ALIGN = /^(left|center|right|justify)$/i;

/**
 * Check if a URL has a safe protocol. Returns empty string if unsafe.
 */
export function sanitizeUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) return "";
	// Relative URLs and protocol-relative are OK
	if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("#")) {
		return trimmed;
	}
	// Check for allowed protocols
	if (SAFE_PROTOCOLS.test(trimmed)) return trimmed;
	// No protocol = assume relative
	if (!trimmed.includes(":")) return trimmed;
	// Blocked protocol (javascript:, data:, vbscript:, etc.)
	return "";
}

/**
 * Strip dangerous HTML tags and attributes from htmlon content.
 * This is a migration-time sanitizer, not a runtime one.
 */
export function sanitizeHtml(html: string): string {
	let result = html;
	// Remove <script> blocks
	result = result.replace(/<script[\s\S]*?<\/script>/gi, "");
	// Remove <style> blocks
	result = result.replace(/<style[\s\S]*?<\/style>/gi, "");
	// Remove event handler attributes (on*)
	result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, "");
	// Remove javascript: in href/src attributes
	result = result.replace(/(href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '$1=""');
	// Remove <iframe>, <embed>, <object>, <applet>, <form>
	result = result.replace(/<\/?(iframe|embed|object|applet|form|base|meta|link)\b[^>]*>/gi, "");
	return result;
}

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

	if (options.htmlon) {
		// htmlon: preserve raw HTML but strip dangerous elements
		html = sanitizeHtml(html);
	} else {
		// Escape HTML then apply BBCode conversions
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

	// [url=href]text[/url] — with protocol filtering
	result = result.replace(/\[url=([^\]]*)\]([\s\S]*?)\[\/url\]/gi, (_, href, text) => {
		const safe = sanitizeUrl(href);
		return safe ? `<a href="${safe}">${text}</a>` : text;
	});
	result = result.replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_, href) => {
		const safe = sanitizeUrl(href);
		return safe ? `<a href="${safe}">${safe}</a>` : escapeHtml(href);
	});

	// [img]src[/img] — with protocol filtering
	result = result.replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_, src) => {
		const safe = sanitizeUrl(src);
		return safe ? `<img src="${safe}">` : "";
	});

	// [color=xxx]text[/color] — validate color value
	result = result.replace(/\[color=([^\]]*)\]([\s\S]*?)\[\/color\]/gi, (_, color, text) => {
		if (SAFE_COLOR.test(color.trim())) {
			return `<span style="color:${color.trim()}">${text}</span>`;
		}
		return text; // Invalid color — strip the tag, keep content
	});

	// [size=N]text[/size]
	result = result.replace(/\[size=([^\]]*)\]([\s\S]*?)\[\/size\]/gi, (_, size, text) => {
		const fontSize = SIZE_MAP[size] ?? `${size}px`;
		return `<span style="font-size:${fontSize}">${text}</span>`;
	});

	// [align=xxx]text[/align] — validate alignment value
	result = result.replace(/\[align=([^\]]*)\]([\s\S]*?)\[\/align\]/gi, (_, align, text) => {
		if (SAFE_ALIGN.test(align.trim())) {
			return `<div style="text-align:${align.trim()}">${text}</div>`;
		}
		return text; // Invalid align — strip the tag, keep content
	});

	// [attach]aid[/attach] → placeholder element
	result = result.replace(
		/\[attach\](\d+)\[\/attach\]/gi,
		(_, aid) => `<attachment data-aid="${aid}"></attachment>`,
	);

	// [list] and [list=1] / [*]
	// Track ordered vs unordered for correct closing tags
	result = result.replace(/\[list=1\]/gi, "<ol>");
	result = result.replace(/\[list\]/gi, "<ul>");
	// Close [/list] with correct tag based on nearest open tag
	result = closeListTags(result);
	result = result.replace(/\[\*\]/gi, "<li>");

	return result;
}

/**
 * Replace [/list] with the correct </ol> or </ul> based on context.
 * Scans for the nearest preceding unclosed <ol> or <ul> and matches.
 */
function closeListTags(html: string): string {
	const parts = html.split(/\[\/list\]/gi);
	if (parts.length <= 1) return html;

	const result: string[] = [parts[0]];
	for (let i = 1; i < parts.length; i++) {
		// Look at everything before this [/list] to find the last unclosed list tag
		const _preceding = result.join("") + (parts[i] ?? "");
		const stack: string[] = [];

		// Simple stack-based approach on the accumulated content so far
		const accumulated = result.join("");
		const tagRegex = /<(ol|ul)>|<\/(ol|ul)>/g;
		let m: RegExpExecArray | null;
		m = tagRegex.exec(accumulated);
		while (m !== null) {
			if (m[1]) {
				stack.push(m[1]); // Opening tag
			} else if (m[2] && stack.length > 0) {
				stack.pop(); // Closing tag
			}
			m = tagRegex.exec(accumulated);
		}

		// The last unclosed tag tells us what to close
		const lastOpen = stack.length > 0 ? stack[stack.length - 1] : "ul";
		result.push(`</${lastOpen}>`);
		if (i < parts.length) {
			result.push(parts[i]);
		}
	}

	return result.join("");
}
