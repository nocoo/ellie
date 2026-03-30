// lib/safe-html.ts — Whitelist-based HTML sanitizer for inline rich text
//
// Supports a minimal safe subset: text formatting + color + links.
// Everything else is stripped to plain text. Use for forum descriptions
// and other user-provided inline HTML fields.
//
// Usage (RSC / server component):
//   <span dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(raw) }} />

/** Allowed tags and their permitted attributes. */
const ALLOW_LIST: Record<string, Set<string>> = {
	strong: new Set(),
	b: new Set(),
	em: new Set(),
	i: new Set(),
	u: new Set(),
	s: new Set(),
	font: new Set(["color"]),
	span: new Set(["style"]),
	a: new Set(["href", "title", "target", "rel"]),
	br: new Set(),
};

/** Matches any HTML tag (opening, closing, or self-closing). */
const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)?\/?>/g;

/** Matches a single attribute: name="value" or name='value'. */
const ATTR_RE = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Only allow safe CSS properties inside style="..." (color only). */
const SAFE_STYLE_RE = /^\s*color\s*:\s*[^;]+;?\s*$/i;

/** Sanitize an attribute value to prevent javascript: URLs etc. */
function isSafeValue(attr: string, value: string): boolean {
	if (attr === "href") {
		const trimmed = value.trim().toLowerCase();
		// Block javascript:, data:, vbscript: schemes
		if (/^(javascript|data|vbscript)\s*:/i.test(trimmed)) return false;
		return true;
	}
	if (attr === "style") {
		return SAFE_STYLE_RE.test(value);
	}
	if (attr === "color") {
		// Allow hex colors, named colors, rgb() — block anything with script-like content
		if (/[<>"'()]/g.test(value) && !/^rgb/i.test(value)) return false;
		return true;
	}
	return true;
}

/**
 * Sanitize inline HTML, keeping only whitelisted tags and attributes.
 * All other tags are stripped (content preserved). HTML entities are kept as-is.
 *
 * @param html - Raw HTML string (may be empty/undefined)
 * @returns Sanitized HTML safe for dangerouslySetInnerHTML
 */
export function sanitizeInlineHtml(html: string | undefined | null): string {
	if (!html) return "";

	return html.replace(TAG_RE, (match, tagName: string, attrString: string) => {
		const tag = tagName.toLowerCase();
		const allowedAttrs = ALLOW_LIST[tag];

		// Not in whitelist — strip the tag entirely (keep content by returning "")
		if (!allowedAttrs) return "";

		// Closing tag
		if (match.startsWith("</")) return `</${tag}>`;

		// Self-closing (e.g. <br />)
		if (allowedAttrs.size === 0) {
			return `<${tag}>`;
		}

		// Parse and filter attributes
		const safeAttrs: string[] = [];
		const raw = attrString || "";
		ATTR_RE.lastIndex = 0;
		for (let attrMatch = ATTR_RE.exec(raw); attrMatch !== null; attrMatch = ATTR_RE.exec(raw)) {
			const attrName = attrMatch[1].toLowerCase();
			const attrValue = attrMatch[2] ?? attrMatch[3] ?? "";
			if (allowedAttrs.has(attrName) && isSafeValue(attrName, attrValue)) {
				safeAttrs.push(`${attrName}="${attrValue}"`);
			}
		}

		// Force safe link attributes
		if (tag === "a") {
			if (!safeAttrs.some((a) => a.startsWith("rel="))) {
				safeAttrs.push('rel="nofollow noopener"');
			}
			if (!safeAttrs.some((a) => a.startsWith("target="))) {
				safeAttrs.push('target="_blank"');
			}
		}

		const attrStr = safeAttrs.length > 0 ? ` ${safeAttrs.join(" ")}` : "";
		return `<${tag}${attrStr}>`;
	});
}
