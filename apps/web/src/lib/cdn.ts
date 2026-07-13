// CDN helpers for Discuz static assets hosted on R2.

const CDN_BASE = "https://t.no.mt";

/** Static image URL under /static/image/common/ */
export function getStaticImageUrl(filename: string): string {
	return `${CDN_BASE}/static/image/common/${filename}`;
}

/** Stamp image URL under /static/image/stamp/ */
export function getStampImageUrl(filename: string): string {
	return `${CDN_BASE}/static/image/stamp/${filename}`;
}

/** Smiley image URL under /static/image/smiley/{directory}/{filename} */
export function getSmileyUrl(directory: string, filename: string): string {
	return `${CDN_BASE}/static/image/smiley/${directory}/${filename}`;
}

/**
 * Attachment URL — filePath is the relative path stored in DB.
 * Security: Only allows paths from CDN_BASE. External URLs, javascript:, data:, etc. are rejected.
 */
export function getAttachmentUrl(filePath: string): string {
	// Reject empty or whitespace-only paths
	if (!filePath?.trim()) {
		return `${CDN_BASE}/`;
	}

	// Reject dangerous protocols (javascript:, data:, vbscript:, etc.)
	const lowerPath = filePath.toLowerCase().trim();
	if (
		lowerPath.startsWith("javascript:") ||
		lowerPath.startsWith("data:") ||
		lowerPath.startsWith("vbscript:") ||
		lowerPath.startsWith("file:")
	) {
		return `${CDN_BASE}/`;
	}

	// If it's an absolute URL, only allow if it's from our CDN
	if (filePath.startsWith("http://") || filePath.startsWith("https://")) {
		try {
			const url = new URL(filePath);
			const cdnUrl = new URL(CDN_BASE);
			// Only allow URLs from the same host as CDN_BASE
			if (url.host === cdnUrl.host) {
				return filePath;
			}
		} catch {
			// Invalid URL, fall through to CDN path
		}
		// External URL detected - return safe fallback
		return `${CDN_BASE}/`;
	}

	// Relative path - prepend CDN base
	// Sanitize: remove any ../ attempts and ensure single leading slash
	const sanitizedPath = filePath
		.replace(/\.\.\//g, "") // Remove directory traversal
		.replace(/^\/+/, "/"); // Ensure single leading slash

	const path = sanitizedPath.startsWith("/") ? sanitizedPath : `/${sanitizedPath}`;
	return `${CDN_BASE}${path}`;
}

/** Attachment thumbnail URL */
export function getAttachmentThumbUrl(filePath: string): string {
	const url = getAttachmentUrl(filePath);
	return `${url}.thumb.jpg`;
}
