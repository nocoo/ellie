// Avatar proxy helpers — used by /api/avatar/[uid]/route.ts

export const CDN_BASE = "https://t.no.mt/avatar";
export const FALLBACK_URL = "https://t.no.mt/static/image/common/tavatar.gif";

/**
 * Compute the CDN path for an avatar given a user ID.
 * UID is zero-padded to 9 digits and split into directory structure.
 *
 * @example computeAvatarCdnPath(12345) => "https://t.no.mt/avatar/000/01/23/45_avatar_big.jpg"
 */
export function computeAvatarCdnPath(uid: number): string {
	const padded = uid.toString().padStart(9, "0");
	const dir1 = padded.slice(0, 3);
	const dir2 = padded.slice(3, 5);
	const dir3 = padded.slice(5, 7);
	const file = padded.slice(7, 9);
	// Always fetch big avatar — size parameter is deprecated
	return `${CDN_BASE}/${dir1}/${dir2}/${dir3}/${file}_avatar_big.jpg`;
}

/**
 * Get cache control header based on request and response state.
 *
 * Cache strategy:
 * - ?v= present (fresh upload): no-cache to force revalidation
 * - Fallback response (no avatar): cache 1 day
 * - Normal avatar: cache 7 days
 *
 * Key insight: when ?v= is present and CDN returns 404, we must NOT cache
 * the fallback GIF, otherwise the user sees stale fallback until it expires.
 */
export function getCacheControl(hasVersionParam: boolean, isFallback: boolean): string {
	if (hasVersionParam) {
		// Fresh upload request — never cache, always revalidate
		return "public, max-age=0, must-revalidate";
	}
	if (isFallback) {
		// Normal fallback — cache for 1 day
		return "public, max-age=86400";
	}
	// Normal avatar — cache for 7 days
	return "public, max-age=604800";
}
