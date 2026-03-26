// viewmodels/forum/smiley.ts — Smiley image compatibility renderer
// Ref: 04e §表情系统 — /smileys/ image validation and rendering helpers
// Runtime: migrated HTML already contains <img> tags, these utils
// validate/process them for safe rendering.

/**
 * Allowed smiley path prefix. All smiley images live under /smileys/.
 */
const SMILEY_PATH_PREFIX = "/smileys/";

/**
 * Allowed image extensions for smiley files.
 */
const SMILEY_EXTENSIONS = new Set([".gif", ".png", ".jpg", ".jpeg"]);

/**
 * Validate that a URL is a legitimate smiley image path.
 * Prevents path traversal and only allows /smileys/ prefix with known extensions.
 */
export function isSmileyUrl(src: string): boolean {
	if (!src.startsWith(SMILEY_PATH_PREFIX)) return false;

	// Reject path traversal attempts
	if (src.includes("..") || src.includes("//")) return false;

	// Extract extension
	const dotIndex = src.lastIndexOf(".");
	if (dotIndex === -1) return false;
	const ext = src.slice(dotIndex).toLowerCase();

	return SMILEY_EXTENSIONS.has(ext);
}

/**
 * Extract smiley pack name from a smiley URL.
 * e.g. "/smileys/default/smile.gif" → "default"
 */
export function extractSmileyPack(src: string): string | null {
	if (!isSmileyUrl(src)) return null;

	const withoutPrefix = src.slice(SMILEY_PATH_PREFIX.length);
	const slashIndex = withoutPrefix.indexOf("/");
	if (slashIndex === -1) return null;

	return withoutPrefix.slice(0, slashIndex);
}

/**
 * Extract smiley filename from a smiley URL.
 * e.g. "/smileys/default/smile.gif" → "smile.gif"
 */
export function extractSmileyFilename(src: string): string | null {
	if (!isSmileyUrl(src)) return null;

	const lastSlash = src.lastIndexOf("/");
	if (lastSlash === -1) return null;

	return src.slice(lastSlash + 1);
}

/**
 * Regex to match smiley <img> tags in HTML content.
 * Matches: <img src="/smileys/..." alt="..." class="smiley" />
 * The migration (Doc03) produces this exact format.
 */
const SMILEY_IMG_REGEX = /<img\s+[^>]*src="(\/smileys\/[^"]+)"[^>]*>/gi;

/**
 * Count smiley images in an HTML string.
 * Useful for analytics or display limits.
 */
export function countSmileys(html: string): number {
	const matches = html.match(SMILEY_IMG_REGEX);
	return matches?.length ?? 0;
}

/**
 * Extract all smiley image sources from HTML content.
 * Returns array of /smileys/ paths found in img tags.
 */
export function extractSmileyUrls(html: string): string[] {
	const results: string[] = [];
	let match: RegExpExecArray | null;
	const regex = new RegExp(SMILEY_IMG_REGEX.source, "gi");

	match = regex.exec(html);
	while (match !== null) {
		const src = match[1];
		if (src && isSmileyUrl(src)) {
			results.push(src);
		}
		match = regex.exec(html);
	}

	return results;
}

/**
 * Dimensions for inline smiley images (consistent with DZ rendering).
 */
export const SMILEY_SIZE = { width: 24, height: 24 } as const;

/**
 * Generate CSS class list for a smiley img element.
 */
export function smileyClassName(): string {
	return "smiley inline-block align-text-bottom";
}
