// CDN helpers for Discuz static assets hosted on R2.

const CDN_BASE = "https://t.no.mt";

/** Fallback avatar (default Discuz "tavatar.gif") served from CDN. */
export const FALLBACK_AVATAR_URL = `${CDN_BASE}/static/image/common/tavatar.gif`;

/** Static image URL under /static/image/common/ */
export function getStaticImageUrl(filename: string): string {
	return `${CDN_BASE}/static/image/common/${filename}`;
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

/**
 * Compute the legacy CDN path for an avatar given a user ID.
 *
 * UID is zero-padded to 9 digits then split into directory structure
 * (matches the original Discuz layout, mirrored from the web app's
 * `apps/web/src/lib/avatar-proxy.ts` so admin and forum stay in sync).
 *
 * @example
 *   computeLegacyAvatarCdnPath(12345)
 *   => "https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg"
 */
export function computeLegacyAvatarCdnPath(uid: number): string {
	const padded = uid.toString().padStart(9, "0");
	const dir1 = padded.slice(0, 3);
	const dir2 = padded.slice(3, 5);
	const dir3 = padded.slice(5, 7);
	const file = padded.slice(7, 9);
	return `${CDN_BASE}/avatar/${dir1}/${dir2}/${dir3}/${file}_avatar_big.jpg`;
}

/**
 * Resolve the displayable avatar URL for a user.
 *
 * - `avatarPath` set → direct CDN path (`https://t.no.mt/{avatarPath}`),
 *   matching the GUID-based pipeline in `apps/web/src/lib/avatar.ts`.
 * - Otherwise → the legacy UID-based path. The browser is expected to
 *   `onError` swap to {@link FALLBACK_AVATAR_URL} when the legacy file
 *   doesn't exist.
 *
 * Guards against `uid <= 0` and an `avatarPath` of just whitespace by
 * returning the fallback directly so callers don't have to special-case.
 */
export function getUserAvatarUrl(uid: number, avatarPath?: string | null): string {
	if (avatarPath && avatarPath.trim().length > 0) {
		const cleaned = avatarPath.replace(/^\/+/, "");
		return `${CDN_BASE}/${cleaned}`;
	}
	if (!Number.isFinite(uid) || uid <= 0) return FALLBACK_AVATAR_URL;
	return computeLegacyAvatarCdnPath(uid);
}
