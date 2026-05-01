// lib/text.ts — Plain-text extraction utilities
//
// Lightweight regex-based HTML stripping for text snippets and previews.
// NOT a sanitizer — use content-filter.ts / DOMPurify for security-critical HTML.

/**
 * Strip all HTML tags from a string, returning plain text.
 *
 * Uses a simple regex that handles normal tag structures.
 * Does NOT decode HTML entities (&amp; stays as-is).
 * Suitable for quote snippets, search excerpts, and content validation.
 */
export function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

/**
 * Build a plain-text quote snippet from HTML content.
 *
 * Pipeline:
 * 1. Strip HTML tags
 * 2. Truncate to maxLength characters
 * 3. Append "..." if truncated
 *
 * @param content - HTML content to extract text from
 * @param maxLength - Maximum character length (default 200)
 * @returns Plain-text snippet, possibly truncated with "..."
 */
export function buildQuoteSnippet(content: string, maxLength = 200): string {
	const plainText = stripHtmlTags(content);
	if (plainText.length <= maxLength) return plainText;
	return `${plainText.slice(0, maxLength)}...`;
}
