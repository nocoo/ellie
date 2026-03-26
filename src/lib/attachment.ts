// lib/attachment.ts — Attachment URL helpers
// Ref: 04a §Content Format — filePath → public URL rules

const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_URL ?? "https://r2.example.com";

/** Convert Attachment.filePath (R2 object key) to public access URL */
export function attachmentUrl(filePath: string): string {
	return `${R2_PUBLIC_BASE}/${filePath}`;
}

/** Thumbnail URL: append .thumb.jpg to filePath. Only valid when hasThumb === true. */
export function thumbnailUrl(filePath: string): string {
	return `${R2_PUBLIC_BASE}/${filePath}.thumb.jpg`;
}

// ─── Sanitize ───────────────────────────────────────────
// Ref: 04a §Sanitize Rules — same rules used at migration time and runtime

/** Allowed URL protocols */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "ftp:", "mailto:"]);

/** Tags that are completely forbidden */
const FORBIDDEN_TAGS = new Set([
	"script",
	"style",
	"iframe",
	"embed",
	"object",
	"applet",
	"form",
	"base",
	"meta",
	"link",
]);

/** Allowed CSS properties and value validators */
const ALLOWED_CSS: Record<string, (v: string) => boolean> = {
	color: (v) => /^(#[0-9a-fA-F]{3,6}|[a-zA-Z]+|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))$/.test(v),
	"font-size": (v) => /^\d+px$/.test(v),
	"text-align": (v) => /^(left|center|right|justify)$/.test(v),
};

/**
 * Check if a URL string is safe (allowed protocol or relative path).
 * Returns true for safe URLs, false for dangerous ones (javascript:, data:, etc.)
 */
export function isSafeUrl(url: string): boolean {
	const trimmed = url.trim();
	// Relative paths are safe
	if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("#")) {
		return true;
	}
	// Check protocol
	try {
		const parsed = new URL(trimmed);
		return SAFE_PROTOCOLS.has(parsed.protocol);
	} catch {
		// If it can't be parsed as absolute URL, treat as relative (safe)
		return true;
	}
}

/**
 * Check if a tag name is forbidden.
 */
export function isForbiddenTag(tagName: string): boolean {
	return FORBIDDEN_TAGS.has(tagName.toLowerCase());
}

/**
 * Sanitize a CSS property-value pair. Returns the value if allowed, null otherwise.
 */
export function sanitizeCssProperty(property: string, value: string): string | null {
	const validator = ALLOWED_CSS[property.toLowerCase()];
	if (!validator) return null;
	return validator(value.trim()) ? value.trim() : null;
}

/**
 * Check if an attribute name is a dangerous event handler (on*).
 */
export function isDangerousAttribute(name: string): boolean {
	return name.toLowerCase().startsWith("on");
}
